import { geoMercator, geoPath } from "d3-geo";
import type { CityGroup, GeoBasemap, GeoCity, GeographyData } from "./types";

export interface MapCamera {
  longitude: number;
  latitude: number;
  zoom: number;
}

export interface ScreenCity {
  x: number;
  y: number;
  entry: CityGroup;
}

export interface MapCluster {
  x: number;
  y: number;
  cities: CityGroup[];
  count: number;
}

/** 屏幕空间聚合；聚合数字按团体 ID 去重，不累加各城市数量。 */
export function clusterScreenCities(
  points: readonly ScreenCity[],
  distance = 56,
): MapCluster[] {
  const clusters: MapCluster[] = points.map(({ x, y, entry }) => ({
    x,
    y,
    cities: [entry],
    count: entry.count,
  }));
  // 合并后重新检查距离，避免两个 44px 触控点的命中区域互相重叠。
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        const left = clusters[a];
        const right = clusters[b];
        if (Math.hypot(left.x - right.x, left.y - right.y) >= distance)
          continue;
        const size = left.cities.length + right.cities.length;
        left.x =
          (left.x * left.cities.length + right.x * right.cities.length) / size;
        left.y =
          (left.y * left.cities.length + right.y * right.cities.length) / size;
        left.cities.push(...right.cities);
        left.count = new Set(
          left.cities.flatMap((city) => city.groups.map((group) => group.id)),
        ).size;
        clusters.splice(b, 1);
        merged = true;
        break outer;
      }
    }
  }
  return clusters;
}

export function validCamera(camera: MapCamera): boolean {
  return (
    Number.isFinite(camera.longitude) &&
    camera.longitude >= 60 &&
    camera.longitude <= 150 &&
    Number.isFinite(camera.latitude) &&
    camera.latitude >= -10 &&
    camera.latitude <= 65 &&
    Number.isFinite(camera.zoom) &&
    camera.zoom >= 1 &&
    camera.zoom <= 32
  );
}

const SVG = "http://www.w3.org/2000/svg";
function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes))
    node.setAttribute(name, value);
  return node;
}

/** 仅改变副本的球面环向，保留输入 GeoJSON 与底图来源数据。 */
export function orientBasemap(basemap: GeoBasemap): GeoBasemap {
  const ring = (
    coordinates: [number, number][],
    exterior: boolean,
  ): [number, number][] => {
    const area = coordinates.reduce((sum, point, i) => {
      const next = coordinates[(i + 1) % coordinates.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    return (exterior ? area > 0 : area < 0)
      ? [...coordinates].reverse()
      : [...coordinates];
  };
  return {
    ...basemap,
    features: basemap.features.map((feature) => {
      const geometry = feature.geometry;
      return {
        ...feature,
        geometry:
          geometry.type === "Polygon"
            ? {
                ...geometry,
                coordinates: geometry.coordinates.map((points, i) =>
                  ring(points, i === 0),
                ),
              }
            : geometry.type === "MultiPolygon"
              ? {
                  ...geometry,
                  coordinates: geometry.coordinates.map((polygon) =>
                    polygon.map((points, i) => ring(points, i === 0)),
                  ),
                }
              : geometry,
      };
    }),
  };
}

interface MapOptions {
  onProvince: (id: string) => void;
  onCity: (city: GeoCity) => void;
  onCluster: (cities: CityGroup[]) => void;
  onCamera: (camera: MapCamera) => void;
}

export class GeographyMap {
  private readonly svg = svgNode("svg", {
    tabindex: "0",
    role: "group",
    "aria-label": "全国团体地图工作面",
    "aria-describedby": "geography-map-help",
  });
  private readonly land = svgNode("g");
  private readonly markers = svgNode("g", { "aria-label": "城市聚合点" });
  private readonly labels = svgNode("g", { "aria-hidden": "true" });
  private readonly projection = geoMercator();
  private readonly path = geoPath(this.projection);
  private readonly basemap: GeoBasemap;
  private readonly observer: ResizeObserver;
  private width = 800;
  private height = 600;
  private camera: MapCamera = { longitude: 105, latitude: 35, zoom: 1 };
  private entries: CityGroup[] = [];
  private provinceId = "";
  private cityId = "";
  private shift: [number, number] = [0, 0];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private suppressClickUntil = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly data: GeographyData,
    private readonly options: MapOptions,
  ) {
    if (!data.basemap?.features.length) throw new Error("地理底图暂不可用");
    this.basemap = orientBasemap(data.basemap);
    this.svg.append(this.land, this.labels, this.markers);
    host.prepend(this.svg);
    for (const feature of this.basemap.features) {
      const node = svgNode("path", {
        class: "geography-province",
        "data-province": feature.properties.provinceId ?? "",
        "aria-label": feature.properties.name,
      });
      const title = svgNode("title");
      title.textContent = feature.properties.name;
      node.append(title);
      if (
        feature.properties.provinceId &&
        ["Polygon", "MultiPolygon"].includes(feature.geometry.type)
      ) {
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "-1");
      }
      if (feature.geometry.type.includes("Line")) {
        node.style.fill = "none";
        node.style.pointerEvents = "none";
      }
      if (feature.geometry.type === "Point")
        node.setAttribute("class", "geography-geographic-symbol");
      node.addEventListener("click", () => {
        if (Date.now() < this.suppressClickUntil) return;
        if (feature.properties.provinceId)
          options.onProvince(feature.properties.provinceId);
      });
      node.addEventListener("keydown", (event) => {
        if (
          (event.key === "Enter" || event.key === " ") &&
          feature.properties.provinceId
        ) {
          event.preventDefault();
          options.onProvince(feature.properties.provinceId);
        }
      });
      this.land.append(node);
    }
    this.resize();
    this.fit();
    this.observer = new window.ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.bindGestures();
  }

  private resize(): void {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    if (this.width < 1 || this.height < 1) return;
    this.svg.setAttribute("viewBox", `0 0 ${this.width} ${this.height}`);
    this.projection.fitExtent(
      [
        [24, 70],
        [this.width - 24, this.height - 42],
      ],
      this.basemap,
    );
    [...this.land.children].forEach((node, i) =>
      node.setAttribute("d", this.path(this.basemap.features[i]) ?? ""),
    );
    this.draw();
  }

  update(entries: CityGroup[], provinceId: string, cityId: string): void {
    this.suppressClickUntil = 0;
    this.entries = entries;
    this.provinceId = provinceId;
    this.cityId = cityId;
    for (const node of this.land.children) {
      if (node.getAttribute("role") !== "button") continue;
      node.setAttribute(
        "aria-pressed",
        String(
          Boolean(provinceId) &&
            node.getAttribute("data-province") === provinceId,
        ),
      );
    }
    this.draw();
  }

  getCamera(): MapCamera {
    return { ...this.camera };
  }

  setCamera(camera: MapCamera, notify = false): void {
    if (!validCamera(camera)) return;
    clearTimeout(this.timer);
    this.camera = { ...camera };
    this.draw();
    if (notify) this.queueCamera();
  }

  fit(provinceId = "", city?: GeoCity): void {
    if (city) {
      this.setCamera({
        longitude: city.longitude,
        latitude: city.latitude,
        zoom: 12,
      });
      return;
    }
    const features = this.basemap.features.filter(
      (feature) => feature.properties.provinceId === provinceId,
    );
    const selection =
      provinceId && features.length
        ? { type: "FeatureCollection" as const, features }
        : this.basemap;
    const [[x0, y0], [x1, y1]] = this.path.bounds(selection);
    const center = this.projection.invert?.([(x0 + x1) / 2, (y0 + y1) / 2]);
    if (!center) return;
    const zoom =
      provinceId && features.length
        ? Math.max(
            1,
            Math.min(
              16,
              Math.min(
                (this.width - 100) / Math.max(1, x1 - x0),
                (this.height - 140) / Math.max(1, y1 - y0),
              ),
            ),
          )
        : 1;
    this.setCamera({ longitude: center[0], latitude: center[1], zoom });
  }

  zoom(
    factor: number,
    point: [number, number] = [this.width / 2, this.height / 2],
  ): void {
    const previous = this.camera.zoom;
    const next = Math.max(1, Math.min(32, previous * factor));
    const ratio = next / previous;
    const offset: [number, number] = [
      point[0] - (point[0] - this.shift[0]) * ratio,
      point[1] - (point[1] - this.shift[1]) * ratio,
    ];
    this.fromTransform(next, offset);
    this.queueCamera();
  }

  private fromTransform(zoom: number, offset: [number, number]): void {
    const center = this.projection.invert?.([
      (this.width / 2 - offset[0]) / zoom,
      (this.height / 2 - offset[1]) / zoom,
    ]);
    if (!center) return;
    this.setCamera({
      longitude: Math.max(60, Math.min(150, center[0])),
      latitude: Math.max(-10, Math.min(65, center[1])),
      zoom,
    });
  }

  private queueCamera(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.options.onCamera(this.getCamera()), 180);
  }

  private draw(): void {
    const center = this.projection([
      this.camera.longitude,
      this.camera.latitude,
    ]);
    if (!center) return;
    const k = this.camera.zoom;
    this.shift = [
      this.width / 2 - center[0] * k,
      this.height / 2 - center[1] * k,
    ];
    this.land.setAttribute(
      "transform",
      `translate(${this.shift[0]},${this.shift[1]}) scale(${k})`,
    );
    // 地理补充点恒为 6px，不能随镜头放大成虚构岛形或团体点。
    this.basemap.features.forEach((feature, index) => {
      if (feature.geometry.type === "Point")
        this.land.children[index].setAttribute(
          "d",
          this.path.pointRadius(3 / k)(feature) ?? "",
        );
    });
    const points = this.entries.flatMap((entry) => {
      const point = this.projection([
        entry.city.longitude,
        entry.city.latitude,
      ]);
      if (!point) return [];
      const x = point[0] * k + this.shift[0];
      const y = point[1] * k + this.shift[1];
      return x < -30 || y < -30 || x > this.width + 30 || y > this.height + 30
        ? []
        : [{ x, y, entry }];
    });
    const clusters = clusterScreenCities(points);
    const focused = document.activeElement?.getAttribute("data-cluster");
    this.markers.replaceChildren();
    for (const cluster of clusters) {
      const single = cluster.cities.length === 1;
      const city = cluster.cities[0].city;
      const key = cluster.cities
        .map((entry) => entry.city.id)
        .sort()
        .join("|");
      const title = single
        ? `${city.name}，${cluster.count} 支团体，查看名单`
        : `${cluster.cities.length} 个城市，${cluster.count} 支团体，${this.camera.zoom >= 32 ? "选择城市" : "放大展开"}`;
      const marker = svgNode("g", {
        class: "geography-marker",
        transform: `translate(${cluster.x},${cluster.y})`,
        tabindex: "0",
        role: "button",
        "aria-label": title,
        "data-cluster": key,
        "data-selected": String(single && city.id === this.cityId),
        "aria-pressed": String(single && city.id === this.cityId),
      });
      const circle = svgNode("circle", { r: "22" });
      const count = svgNode("text");
      count.textContent = String(cluster.count);
      const label = svgNode("title");
      label.textContent = title;
      marker.append(circle, count, label);
      const activate = (pointer = false): void => {
        if (pointer && Date.now() < this.suppressClickUntil) return;
        this.svg.focus({ preventScroll: true });
        if (single) this.options.onCity(city);
        else if (this.camera.zoom >= 32) this.options.onCluster(cluster.cities);
        else {
          const center = this.projection.invert?.([
            (cluster.x - this.shift[0]) / k,
            (cluster.y - this.shift[1]) / k,
          ]);
          if (center)
            this.setCamera(
              {
                longitude: center[0],
                latitude: center[1],
                zoom: Math.min(32, this.camera.zoom * 3),
              },
              true,
            );
        }
      };
      marker.addEventListener("click", () => activate(true));
      marker.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      this.markers.append(marker);
      if (key === focused) marker.focus({ preventScroll: true });
    }
    this.labels.replaceChildren();
    if (k > 1.8 || this.provinceId) {
      const named = new Set<string>();
      for (const feature of this.basemap.features) {
        const id = feature.properties.provinceId;
        if (
          !id ||
          named.has(id) ||
          !["Polygon", "MultiPolygon"].includes(feature.geometry.type)
        )
          continue;
        named.add(id);
        const [px, py] = this.path.centroid(feature);
        const x = px * k + this.shift[0];
        const y = py * k + this.shift[1];
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 30 ||
          x > this.width - 30 ||
          y < 70 ||
          y > this.height - 30
        )
          continue;
        if (
          clusters.some(
            (cluster) => Math.hypot(cluster.x - x, cluster.y - y) < 65,
          )
        )
          continue;
        const label = svgNode("text", {
          x: String(x),
          y: String(y),
          class: "geography-province-label",
        });
        label.textContent = feature.properties.name;
        this.labels.append(label);
      }
    }
    for (const cluster of clusters) {
      if (cluster.cities.length !== 1) continue;
      if (
        clusters.some(
          (other) =>
            other !== cluster &&
            Math.abs(other.x - cluster.x) < 76 &&
            Math.abs(other.y - cluster.y) < 74,
        )
      )
        continue;
      const label = svgNode("text", {
        x: String(cluster.x),
        y: String(cluster.y + 39),
        class: "geography-marker-label",
      });
      label.textContent = cluster.cities[0].city.name;
      this.labels.append(label);
    }
    const scale = document.getElementById("geography-scale");
    if (scale)
      scale.textContent = `${this.camera.zoom.toFixed(1)}× · ${this.entries.length} 个已定位城市`;
  }

  private bindGestures(): void {
    let drag:
      | { x: number; y: number; shift: [number, number]; moved: boolean }
      | undefined;
    this.svg.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      drag = {
        x: event.clientX,
        y: event.clientY,
        shift: [...this.shift],
        moved: false,
      };
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      if (!event.buttons) {
        drag = undefined;
        return;
      }
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        this.svg.setPointerCapture(event.pointerId);
      }
      if (drag.moved)
        this.fromTransform(this.camera.zoom, [
          drag.shift[0] + dx,
          drag.shift[1] + dy,
        ]);
    });
    const endDrag = (): void => {
      if (drag?.moved) {
        this.suppressClickUntil = Date.now() + 300;
        this.queueCamera();
      }
      drag = undefined;
    };
    this.svg.addEventListener("pointerup", endDrag);
    this.svg.addEventListener("pointercancel", endDrag);
    this.svg.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        const rect = this.svg.getBoundingClientRect();
        this.zoom(
          Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * 0.005),
          [event.clientX - rect.left, event.clientY - rect.top],
        );
      },
      { passive: false },
    );
    this.svg.addEventListener("keydown", (event) => {
      if (event.target !== this.svg) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        [
          "+",
          "=",
          "-",
          "_",
          "Home",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      )
        event.preventDefault();
      if (event.key === "+" || event.key === "=") this.zoom(1.5);
      if (event.key === "-" || event.key === "_") this.zoom(1 / 1.5);
      if (event.key === "Home") {
        this.fit(
          this.provinceId,
          this.data.cities.find((city) => city.id === this.cityId),
        );
        this.queueCamera();
      }
      const move = {
        ArrowLeft: [60, 0],
        ArrowRight: [-60, 0],
        ArrowUp: [0, 60],
        ArrowDown: [0, -60],
      }[event.key];
      if (move) {
        this.fromTransform(this.camera.zoom, [
          this.shift[0] + move[0],
          this.shift[1] + move[1],
        ]);
        this.queueCamera();
      }
    });
    let touch:
      | {
          distance: number;
          midpoint: [number, number];
          shift: [number, number];
          zoom: number;
        }
      | undefined;
    const pair = (
      event: TouchEvent,
    ): { distance: number; midpoint: [number, number] } => {
      const [a, b] = event.touches;
      const rect = this.svg.getBoundingClientRect();
      return {
        distance: Math.max(
          1,
          Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        ),
        midpoint: [
          (a.clientX + b.clientX) / 2 - rect.left,
          (a.clientY + b.clientY) / 2 - rect.top,
        ],
      };
    };
    this.svg.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length !== 2) return;
        event.preventDefault();
        touch = {
          ...pair(event),
          shift: [...this.shift],
          zoom: this.camera.zoom,
        };
      },
      { passive: false },
    );
    this.svg.addEventListener(
      "touchmove",
      (event) => {
        if (!touch || event.touches.length !== 2) return;
        event.preventDefault();
        const next = pair(event);
        const zoom = Math.max(
          1,
          Math.min(32, (touch.zoom * next.distance) / touch.distance),
        );
        const ratio = zoom / touch.zoom;
        this.fromTransform(zoom, [
          next.midpoint[0] - (touch.midpoint[0] - touch.shift[0]) * ratio,
          next.midpoint[1] - (touch.midpoint[1] - touch.shift[1]) * ratio,
        ]);
        this.suppressClickUntil = Date.now() + 400;
      },
      { passive: false },
    );
    const endTouch = (): void => {
      if (touch) this.queueCamera();
      touch = undefined;
    };
    this.svg.addEventListener("touchend", endTouch);
    this.svg.addEventListener("touchcancel", endTouch);
  }

  destroy(): void {
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.svg.remove();
  }
}

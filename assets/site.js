"use strict";
(() => {
  // data/events.v1.json
  var events_v1_default = {
    schemaVersion: "idol-events-v1",
    updatedAt: "2026-09-09T08:02:08.854Z",
    coverage: "partial",
    events: [
      {
        id: "e-weibo-5338755200452940",
        title: "偶像回响 Idol Echo Live Vol.31 · 小丸mori生诞祭",
        date: "2026-09-05",
        province: null,
        city: null,
        venue: "VeinLab未来俱乐部",
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g263",
            name: "TakeBlue"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5338755200452940",
            label: "TakeBlue 本周演出情报",
            publisher: "TakeBlue 官号",
            observedAt: "2026-09-03T11:43:48.400Z",
            kind: "official"
          }
        ],
        notes: "据已归档官号预告整理，未实时复核变更。预告中的 15:40–16:00 为 TakeBlue 出演时段，不能据此确定整场开演时间；仅收录已核实的部分阵容。省市、完整地址和整场时刻未确认。",
        poster: null
      },
      {
        id: "e-weibo-5339142341002069",
        title: "SIN RETORNO 世界树剧场演出",
        date: "2026-09-06",
        province: null,
        city: null,
        venue: "世界树剧场",
        address: null,
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g032",
            name: "SIN RETORNO"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339142341002069",
            label: "SIN RETORNO 本周演出预告",
            publisher: "SIN RETORNO 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          }
        ],
        notes: "标题为依据官宣整理的描述性标题，整场活动正式名称未确认。预告中的 18:20–18:40 为本团出演时段，整场开演时间留空。省市及地址未确认；未实时复核取消、延期或阵容变更。",
        poster: null
      },
      {
        id: "e-weibo-5339009950681922",
        title: "紫禁之巅 Vol.2 —— 京门第一",
        date: "2026-09-06",
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: "北京市西城区廊房头条2号院1号楼2层01号",
        opensAt: null,
        startsAt: null,
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g192",
            name: "PokaPokaTime"
          },
          {
            groupId: "g190",
            name: "風時計Kazetoke"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339009950681922",
            label: "PokaPokaTime 本周活动预告",
            publisher: "PokaPokaTime 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/detail/5339081194342085",
            label: "風時計Kazetoke 本周课程安排",
            publisher: "風時計Kazetoke 官号",
            observedAt: "2026-09-03T11:43:48.400Z",
            kind: "official"
          }
        ],
        notes: "日期和活动全名来自 PokaPokaTime 预告，城市及完整地址由同场活动的風時計Kazetoke 官号预告交叉核对。仅列已核实的部分出演团体，整场入场、开演和结束时刻未确认；未实时复核变更。",
        poster: null
      },
      {
        province: "内蒙古",
        city: "呼和浩特",
        venue: "WHOHOT LIVEHOUSE",
        address: "呼和浩特市赛罕区尚好家快捷酒店南巷",
        opensAt: "13:40",
        startsAt: "14:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: "g185",
            name: "绯色苏打"
          },
          {
            groupId: null,
            name: "MOGUMOGU"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5338640013852929",
            label: "绯色苏打 TWOMAN LIVE 官宣",
            publisher: "绯色苏打 官号",
            observedAt: "2026-09-03T11:46:52.435Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5331060167541520.html",
            label: "绯色苏打 8 月 12 日预告（新浪公开页）",
            publisher: "绯色苏打_Official",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/6579150992/RgdcNn1Bz",
            label: "MOGUMOGU RED²原预告",
            publisher: "MOGUMOGU",
            observedAt: "2026-09-09T07:27:48.327Z",
            kind: "official"
          }
        ],
        notes: "2026-09-09复核MOGUMOGU原预告，补充呼和浩特WHOHOT LIVEHOUSE及地址；日期与OPEN 13:40 / START 14:00和既有绯色苏打预告一致，沿用同一活动ID。MOGUMOGU身份未独立绑定，结束时刻未知。历史预告复核不表示已排除后续取消、延期或阵容变更。",
        poster: null,
        id: "e-weibo-5338640013852929",
        title: "MOGUMOGU生长计划4 · RED²红色的二次方",
        date: "2026-09-13"
      },
      {
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: null,
        opensAt: "18:45",
        startsAt: "19:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "Meguri-Kaado"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/detail/5339115526292485",
            label: "螢石FluorMelo 活动邀请转发",
            publisher: "螢石FluorMelo 官号",
            observedAt: "2026-09-03T11:47:14.413Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5338725122835985.html",
            label: "Meguri-Kaado 9 月 2 日原预告（新浪公开页）",
            publisher: "Meguri-Kaado",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "official"
          },
          {
            url: "https://www.sina.cn/news/detail/5334341322280544.html",
            label: "TrueWorld 场馆城市交叉依据（非本场排期）",
            publisher: "TrueWorld-",
            observedAt: "2026-09-08T08:33:36Z",
            kind: "organizer"
          },
          {
            url: "https://weibo.com/8000320501/RgfpSbTLH",
            label: "Meguri-Kaado Last one-man原预告",
            publisher: "Meguri-Kaado",
            observedAt: "2026-09-09T07:27:58.794Z",
            kind: "official"
          }
        ],
        notes: "2026-09-09复核Meguri-Kaado原帖，确认日期、入场18:45、开演19:00和门空间，沿用同一活动ID。街名廊坊/廊房仍有异写，完整地址继续留空。Stardust为协力致谢，不能据此认定出演；彩色心形不能代替成员名字，Last one-man不能单独证明解散。结束时刻未知，出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-5339115526292485",
        title: "Meguri-Kaado Last one-man",
        date: "2026-09-15"
      },
      {
        province: "上海",
        city: "上海",
        venue: "新歌空间",
        address: "上海市长宁区工人文化宫三楼",
        opensAt: "18:15",
        startsAt: "18:30",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "ReRa"
          },
          {
            groupId: null,
            name: "EMBEFUSE"
          },
          {
            groupId: null,
            name: "ANNIHILATE"
          },
          {
            groupId: null,
            name: "Arena组合"
          },
          {
            groupId: null,
            name: "第六页序"
          },
          {
            groupId: null,
            name: "BubbleLabo"
          },
          {
            groupId: null,
            name: "心跳序曲Prologue"
          },
          {
            groupId: null,
            name: "Token"
          },
          {
            groupId: null,
            name: "RAIJIN"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/4028711630/Rh1KjF7tZ",
            label: "舫Freya教师节专场原预告",
            publisher: "舫Freya",
            observedAt: "2026-09-09T07:26:58.540Z",
            kind: "organizer"
          }
        ],
        notes: "据9月7日原预告及其已编辑正文整理；仅列原文明确的9个演出团体，身份尚未逐一绑定。持教师资格证可无料入场，普通观众票种另列，不能把活动整体标作免费。结束时间未确认；出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rh1kjf7tz",
        title: "舫Freya Fes 6.0 · 教师节专场",
        date: "2026-09-10"
      },
      {
        province: "上海",
        city: "上海",
        venue: "日不落剧场（世界树剧场）",
        address: "南京东路800号第一百货C馆7楼 星空间96号",
        opensAt: "18:30",
        startsAt: "19:00",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "时季SeasonMemories"
          },
          {
            groupId: null,
            name: "蛋黄πSizzle"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/7931467523/RgPxIvAGu",
            label: "时季SeasonMemories Mini Oneman原预告",
            publisher: "时季SeasonMemories",
            observedAt: "2026-09-09T07:27:09.426Z",
            kind: "official"
          },
          {
            url: "https://weibo.com/7716940453/R3Ka7g7s0",
            label: "地下偶像相关揭示板活动汇总",
            publisher: "地下偶像相关揭示板",
            observedAt: "2026-09-09T07:17:25.069Z",
            kind: "aggregator"
          }
        ],
        notes: "日期月日、场地、地址和入场/开演来自时季原预告；2026年及上海由同期聚合汇总同场条目交叉核对。21:30为特典开始，不作为演出结束。普通入场与VIP礼包规则不同；阵容未独立绑定团体档案。出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rgpxivagu",
        title: "时季 1st Mini Oneman「似季」",
        date: "2026-09-11"
      },
      {
        province: "北京",
        city: "北京",
        venue: "门空间TheDoorSpace",
        address: "北京市西城区廊房头条2号院1号楼二层",
        opensAt: "19:15",
        startsAt: "19:30",
        endsAt: null,
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "JADX"
          }
        ],
        sources: [
          {
            url: "https://weibo.com/8013127107/RgnpRiZ0w",
            label: "JADX CAMPUS NOISE北京原预告",
            publisher: "JADX_official",
            observedAt: "2026-09-09T07:27:37.476Z",
            kind: "official"
          }
        ],
        notes: "据JADX原发布者的巡演北京场预告整理。无料入场需提前登记，按当天排队顺序入场；原文注明全程禁止摄影/录像。结束时刻未确认，未推断其他出演者。出发前请核对最新变更。",
        poster: null,
        id: "e-weibo-rgnpriz0w",
        title: "JADX LIVE TOUR 2026「CAMPUS NOISE」北京场",
        date: "2026-09-11"
      },
      {
        province: "北京",
        city: "北京",
        venue: "MASK LIVE",
        address: null,
        opensAt: "12:25",
        startsAt: "12:30",
        endsAt: "16:50",
        status: "scheduled",
        performers: [
          {
            groupId: null,
            name: "SHIRIUSU天狼星"
          }
        ],
        sources: [
          {
            url: "https://www.showstart.com/event/308732",
            label: "秀动Glory偶像事务所演出列表",
            publisher: "Glory偶像事务所（秀动）",
            observedAt: "2026-09-09T07:54:05.166Z",
            kind: "organizer"
          },
          {
            url: "https://www.showstart.com/host/16689619",
            label: "秀动Glory偶像事务所演出列表",
            publisher: "Glory偶像事务所（秀动）",
            observedAt: "2026-09-09T07:54:02.475Z",
            kind: "organizer"
          }
        ],
        notes: "据秀动厂牌页和活动详情交叉核对：厂牌列表明确2026年，详情列OPEN 12:25、START 12:30及票务时间段结束16:50。仅列艺人栏明确的SHIRIUSU天狼星，指名票种名称不作为完整阵容。详情上方与主办正文的街址/楼层写法不同，完整地址留空，请向主办核实。临期安排与阵容可能调整。",
        poster: null,
        id: "e-showstart-308732",
        title: "GLORY星际搭车指南 Vol.40",
        date: "2026-09-12"
      }
    ]
  };

  // data/follower-observations.v1.json
  var follower_observations_v1_default = {
    schemaVersion: "idol-follower-observations-v1",
    updatedAt: null,
    records: []
  };

  // data/follower-observations.v2.json
  var follower_observations_v2_default = {
    schemaVersion: "idol-follower-observations-v2",
    updatedAt: "2026-09-11T03:20:24.005Z",
    records: [
      {
        groupId: "g001",
        uid: "6596154111",
        followersValue: 92996,
        followersDisplay: "92996",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6596154111",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g002",
        uid: "7925233355",
        followersValue: 35722,
        followersDisplay: "35722",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7925233355",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g003",
        uid: "7972569707",
        followersValue: 51064,
        followersDisplay: "51064",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7972569707",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g004",
        uid: "7979554129",
        followersValue: 54192,
        followersDisplay: "54192",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7979554129",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g005",
        uid: "7544960611",
        followersValue: 142986,
        followersDisplay: "142986",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7544960611",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g006",
        uid: "7857163280",
        followersValue: 56621,
        followersDisplay: "56621",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7857163280",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g007",
        uid: "7953472096",
        followersValue: 6474,
        followersDisplay: "6474",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7953472096",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g008",
        uid: "9079552760",
        followersValue: 2761,
        followersDisplay: "2761",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9079552760",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g010",
        uid: "7969451525",
        followersValue: 2862,
        followersDisplay: "2862",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7969451525",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g011",
        uid: "6260769096",
        followersValue: 44355,
        followersDisplay: "44355",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6260769096",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g012",
        uid: "7900265129",
        followersValue: 23487,
        followersDisplay: "23487",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7900265129",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g013",
        uid: "4073361032",
        followersValue: 5707,
        followersDisplay: "5707",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4073361032",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g014",
        uid: "4006565844",
        followersValue: 2643,
        followersDisplay: "2643",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4006565844",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g015",
        uid: "7853232559",
        followersValue: 68074,
        followersDisplay: "68074",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7853232559",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g016",
        uid: "7884621691",
        followersValue: 9950,
        followersDisplay: "9950",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7884621691",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g017",
        uid: "7532605142",
        followersValue: 27781,
        followersDisplay: "27781",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7532605142",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g018",
        uid: "8403167370",
        followersValue: 2437,
        followersDisplay: "2437",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8403167370",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g019",
        uid: "8456812505",
        followersValue: 1356,
        followersDisplay: "1356",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8456812505",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g020",
        uid: "9141744758",
        followersValue: 1945,
        followersDisplay: "1945",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9141744758",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g021",
        uid: "8271931633",
        followersValue: 1657,
        followersDisplay: "1657",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8271931633",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g022",
        uid: "9186921076",
        followersValue: 812,
        followersDisplay: "812",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9186921076",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g023",
        uid: "7867503804",
        followersValue: 33142,
        followersDisplay: "33142",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7867503804",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g024",
        uid: "7730716285",
        followersValue: 130831,
        followersDisplay: "130831",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7730716285",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g025",
        uid: "2140549692",
        followersValue: 22383,
        followersDisplay: "22383",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/2140549692",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g026",
        uid: "8013127107",
        followersValue: 11798,
        followersDisplay: "11798",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8013127107",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g027",
        uid: "7609007975",
        followersValue: 312,
        followersDisplay: "312",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7609007975",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g028",
        uid: "7545720717",
        followersValue: 54342,
        followersDisplay: "54342",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7545720717",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g029",
        uid: "6294175190",
        followersValue: 25408,
        followersDisplay: "25408",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6294175190",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g030",
        uid: "5635046003",
        followersValue: 4449,
        followersDisplay: "4449",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5635046003",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g031",
        uid: "8491554740",
        followersValue: 1712,
        followersDisplay: "1712",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8491554740",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g032",
        uid: "8205003815",
        followersValue: 2084,
        followersDisplay: "2084",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8205003815",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g033",
        uid: "7990767735",
        followersValue: 3142,
        followersDisplay: "3142",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7990767735",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g034",
        uid: "7957747504",
        followersValue: 11540,
        followersDisplay: "11540",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7957747504",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g035",
        uid: "7791947226",
        followersValue: 40372,
        followersDisplay: "40372",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7791947226",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g036",
        uid: "7481447888",
        followersValue: 2696,
        followersDisplay: "2696",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7481447888",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g037",
        uid: "7977495207",
        followersValue: 889,
        followersDisplay: "889",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7977495207",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g038",
        uid: "7805192332",
        followersValue: 634,
        followersDisplay: "634",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7805192332",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g039",
        uid: "8000970271",
        followersValue: 6373,
        followersDisplay: "6373",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8000970271",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g040",
        uid: "7986130007",
        followersValue: 24325,
        followersDisplay: "24325",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7986130007",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g041",
        uid: "9106652275",
        followersValue: 590,
        followersDisplay: "590",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9106652275",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g043",
        uid: "8389259799",
        followersValue: 224,
        followersDisplay: "224",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8389259799",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g045",
        uid: "4013273157",
        followersValue: 935,
        followersDisplay: "935",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4013273157",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g046",
        uid: "8232352622",
        followersValue: 549,
        followersDisplay: "549",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8232352622",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g047",
        uid: "8361936453",
        followersValue: 1519,
        followersDisplay: "1519",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8361936453",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g048",
        uid: "7967851967",
        followersValue: 23296,
        followersDisplay: "23296",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7967851967",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g049",
        uid: "9015693443",
        followersValue: 2168,
        followersDisplay: "2168",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9015693443",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g050",
        uid: "7947439764",
        followersValue: 8040,
        followersDisplay: "8040",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7947439764",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g051",
        uid: "7996816724",
        followersValue: 3124,
        followersDisplay: "3124",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7996816724",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g052",
        uid: "7298525682",
        followersValue: 1090,
        followersDisplay: "1090",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7298525682",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g053",
        uid: "7919013782",
        followersValue: 35802,
        followersDisplay: "35802",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7919013782",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g054",
        uid: "7998857709",
        followersValue: 18483,
        followersDisplay: "18483",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7998857709",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g055",
        uid: "7905575521",
        followersValue: 4938,
        followersDisplay: "4938",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7905575521",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g056",
        uid: "2280398925",
        followersValue: 1343,
        followersDisplay: "1343",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/2280398925",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g057",
        uid: "7896710776",
        followersValue: 4421,
        followersDisplay: "4421",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7896710776",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g058",
        uid: "7889194912",
        followersValue: 6791,
        followersDisplay: "6791",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7889194912",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g059",
        uid: "7927305267",
        followersValue: 858,
        followersDisplay: "858",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7927305267",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g060",
        uid: "2030310713",
        followersValue: 21810,
        followersDisplay: "21810",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/2030310713",
        slotId: "scheduled-2026-09-11",
        identityGate: "reviewed_account_scope",
        entityKind: "事务所账号／原团名关联档案",
        scopeNote: "当前 @SugarHeart_糖心计划 为上海偶像事务所账号。官号更名通告宣布，原组合 SugarHeart 自 2026-08-29 起更名为 neokoro，由 @neokoro_official 作为组合团队微博。本站保留原清单名称及历史资料，下面粉丝量属于事务所账号，不是 neokoro 的粉丝量；当前封面采用品牌图，旧五人团照不作为现役全员照。",
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g061",
        uid: "7373369542",
        followersValue: 174,
        followersDisplay: "174",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7373369542",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g062",
        uid: "8321544591",
        followersValue: 2439,
        followersDisplay: "2439",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8321544591",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g063",
        uid: "7887751959",
        followersValue: 431,
        followersDisplay: "431",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7887751959",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g064",
        uid: "5999784490",
        followersValue: 273,
        followersDisplay: "273",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5999784490",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g065",
        uid: "7692219327",
        followersValue: 3672,
        followersDisplay: "3672",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7692219327",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g066",
        uid: "7950591732",
        followersValue: 10754,
        followersDisplay: "10754",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7950591732",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g067",
        uid: "7931467523",
        followersValue: 1332,
        followersDisplay: "1332",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7931467523",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g068",
        uid: "5415947145",
        followersValue: 273,
        followersDisplay: "273",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5415947145",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g069",
        uid: "7125731001",
        followersValue: 7235,
        followersDisplay: "7235",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7125731001",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g070",
        uid: "8013540569",
        followersValue: 5585,
        followersDisplay: "5585",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8013540569",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g071",
        uid: "8005207784",
        followersValue: 1551,
        followersDisplay: "1551",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8005207784",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g072",
        uid: "7995495602",
        followersValue: 1135,
        followersDisplay: "1135",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7995495602",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g073",
        uid: "7800009262",
        followersValue: 1631,
        followersDisplay: "1631",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7800009262",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g074",
        uid: "7803951971",
        followersValue: 5007,
        followersDisplay: "5007",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7803951971",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g075",
        uid: "9151993601",
        followersValue: 787,
        followersDisplay: "787",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9151993601",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g076",
        uid: "9182652727",
        followersValue: 1488,
        followersDisplay: "1488",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9182652727",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g078",
        uid: "9177405137",
        followersValue: 203,
        followersDisplay: "203",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9177405137",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g079",
        uid: "9177035085",
        followersValue: 488,
        followersDisplay: "488",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9177035085",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g080",
        uid: "8362451838",
        followersValue: 264,
        followersDisplay: "264",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8362451838",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g081",
        uid: "9177970971",
        followersValue: 146,
        followersDisplay: "146",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9177970971",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g082",
        uid: "8019165180",
        followersValue: 890,
        followersDisplay: "890",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8019165180",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g083",
        uid: "9118384008",
        followersValue: 2257,
        followersDisplay: "2257",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9118384008",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g084",
        uid: "6028024793",
        followersValue: 659,
        followersDisplay: "659",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6028024793",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g085",
        uid: "8472141732",
        followersValue: 2163,
        followersDisplay: "2163",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8472141732",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g086",
        uid: "8289628606",
        followersValue: 104,
        followersDisplay: "104",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8289628606",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g087",
        uid: "7877704839",
        followersValue: 2081,
        followersDisplay: "2081",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7877704839",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g088",
        uid: "5609927495",
        followersValue: 1060,
        followersDisplay: "1060",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5609927495",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g089",
        uid: "4055727172",
        followersValue: 490,
        followersDisplay: "490",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4055727172",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g090",
        uid: "7997751325",
        followersValue: 2844,
        followersDisplay: "2844",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7997751325",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g091",
        uid: "8231206346",
        followersValue: 1171,
        followersDisplay: "1171",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8231206346",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g092",
        uid: "5552369486",
        followersValue: 1719,
        followersDisplay: "1719",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5552369486",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g093",
        uid: "7922879720",
        followersValue: 452,
        followersDisplay: "452",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7922879720",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g094",
        uid: "8446797536",
        followersValue: 593,
        followersDisplay: "593",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8446797536",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g096",
        uid: "6443811884",
        followersValue: 220,
        followersDisplay: "220",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6443811884",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g097",
        uid: "6521916177",
        followersValue: 699,
        followersDisplay: "699",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6521916177",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g098",
        uid: "8001784393",
        followersValue: 406,
        followersDisplay: "406",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8001784393",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g099",
        uid: "8359868497",
        followersValue: 327,
        followersDisplay: "327",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8359868497",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g100",
        uid: "8341330068",
        followersValue: 44,
        followersDisplay: "44",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8341330068",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g101",
        uid: "8336442081",
        followersValue: 106,
        followersDisplay: "106",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8336442081",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g103",
        uid: "7920994821",
        followersValue: 2203,
        followersDisplay: "2203",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7920994821",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g104",
        uid: "8263317680",
        followersValue: 1620,
        followersDisplay: "1620",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8263317680",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g105",
        uid: "9035816390",
        followersValue: 156,
        followersDisplay: "156",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9035816390",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g106",
        uid: "7933549670",
        followersValue: 10964,
        followersDisplay: "10964",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7933549670",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g107",
        uid: "7982419913",
        followersValue: 1049,
        followersDisplay: "1049",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7982419913",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g110",
        uid: "7940384278",
        followersValue: 23996,
        followersDisplay: "23996",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7940384278",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g111",
        uid: "7735680902",
        followersValue: 132822,
        followersDisplay: "132822",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7735680902",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g112",
        uid: "7889087589",
        followersValue: 66268,
        followersDisplay: "66268",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7889087589",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g113",
        uid: "7777196754",
        followersValue: 126028,
        followersDisplay: "126028",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7777196754",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g114",
        uid: "7549669146",
        followersValue: 88949,
        followersDisplay: "88949",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7549669146",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g115",
        uid: "7901112897",
        followersValue: 74759,
        followersDisplay: "74759",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7901112897",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g116",
        uid: "7841518645",
        followersValue: 65028,
        followersDisplay: "65028",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7841518645",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g117",
        uid: "5466742004",
        followersValue: 18164,
        followersDisplay: "18164",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5466742004",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g118",
        uid: "9049244822",
        followersValue: 3416,
        followersDisplay: "3416",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9049244822",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g119",
        uid: "4071912167",
        followersValue: 1361,
        followersDisplay: "1361",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4071912167",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g120",
        uid: "7884130361",
        followersValue: 8888,
        followersDisplay: "8888",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7884130361",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g121",
        uid: "6073121292",
        followersValue: 1540,
        followersDisplay: "1540",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6073121292",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g122",
        uid: "7988564618",
        followersValue: 3420,
        followersDisplay: "3420",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7988564618",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g123",
        uid: "8012215777",
        followersValue: 2020,
        followersDisplay: "2020",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8012215777",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g124",
        uid: "7830798257",
        followersValue: 55341,
        followersDisplay: "55341",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7830798257",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g125",
        uid: "7864799082",
        followersValue: 32063,
        followersDisplay: "32063",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7864799082",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g126",
        uid: "7943528678",
        followersValue: 3510,
        followersDisplay: "3510",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7943528678",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g127",
        uid: "9114311004",
        followersValue: 1302,
        followersDisplay: "1302",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9114311004",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g128",
        uid: "8013612297",
        followersValue: 2237,
        followersDisplay: "2237",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8013612297",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g129",
        uid: "7983112875",
        followersValue: 52540,
        followersDisplay: "52540",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7983112875",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g130",
        uid: "8372888310",
        followersValue: 17835,
        followersDisplay: "17835",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8372888310",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g131",
        uid: "7364564222",
        followersValue: 12558,
        followersDisplay: "12558",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7364564222",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g132",
        uid: "7057598265",
        followersValue: 1393,
        followersDisplay: "1393",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7057598265",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g133",
        uid: "7879504592",
        followersValue: 19785,
        followersDisplay: "19785",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7879504592",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g134",
        uid: "9195236104",
        followersValue: 500,
        followersDisplay: "500",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9195236104",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g135",
        uid: "6765538693",
        followersValue: 6186,
        followersDisplay: "6186",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6765538693",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g136",
        uid: "7942257229",
        followersValue: 34115,
        followersDisplay: "34115",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7942257229",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g137",
        uid: "7950374471",
        followersValue: 6267,
        followersDisplay: "6267",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7950374471",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g138",
        uid: "5363341966",
        followersValue: 1721,
        followersDisplay: "1721",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5363341966",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g139",
        uid: "7943479278",
        followersValue: 2685,
        followersDisplay: "2685",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7943479278",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g141",
        uid: "7957054006",
        followersValue: 6836,
        followersDisplay: "6836",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7957054006",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g142",
        uid: "7919557370",
        followersValue: 3372,
        followersDisplay: "3372",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7919557370",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g143",
        uid: "7945987305",
        followersValue: 11112,
        followersDisplay: "11112",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7945987305",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g144",
        uid: "8005960120",
        followersValue: 24204,
        followersDisplay: "24204",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8005960120",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g145",
        uid: "8303818262",
        followersValue: 437,
        followersDisplay: "437",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8303818262",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g147",
        uid: "7964317545",
        followersValue: 10196,
        followersDisplay: "10196",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7964317545",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g148",
        uid: "4032188824",
        followersValue: 1492,
        followersDisplay: "1492",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4032188824",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g149",
        uid: "7982434744",
        followersValue: 2780,
        followersDisplay: "2780",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7982434744",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g150",
        uid: "7590494308",
        followersValue: 296,
        followersDisplay: "296",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7590494308",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g151",
        uid: "7867583942",
        followersValue: 1523,
        followersDisplay: "1523",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7867583942",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g152",
        uid: "7979158786",
        followersValue: 2765,
        followersDisplay: "2765",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7979158786",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g153",
        uid: "8447113873",
        followersValue: 211,
        followersDisplay: "211",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8447113873",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g154",
        uid: "6661812238",
        followersValue: 257,
        followersDisplay: "257",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6661812238",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g155",
        uid: "6063008162",
        followersValue: 878,
        followersDisplay: "878",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6063008162",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g156",
        uid: "4008008764",
        followersValue: 482,
        followersDisplay: "482",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4008008764",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g157",
        uid: "8293434874",
        followersValue: 553,
        followersDisplay: "553",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8293434874",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g158",
        uid: "8492918359",
        followersValue: 180,
        followersDisplay: "180",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8492918359",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g159",
        uid: "6475736725",
        followersValue: 1987,
        followersDisplay: "1987",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6475736725",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g160",
        uid: "8232845446",
        followersValue: 1292,
        followersDisplay: "1292",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8232845446",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g161",
        uid: "8314782269",
        followersValue: 1196,
        followersDisplay: "1196",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8314782269",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g162",
        uid: "2141625932",
        followersValue: 1898,
        followersDisplay: "1898",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/2141625932",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g164",
        uid: "8264720433",
        followersValue: 854,
        followersDisplay: "854",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8264720433",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g165",
        uid: "6055634313",
        followersValue: 2069,
        followersDisplay: "2069",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6055634313",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g166",
        uid: "9154323235",
        followersValue: 737,
        followersDisplay: "737",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9154323235",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g167",
        uid: "9026139384",
        followersValue: 950,
        followersDisplay: "950",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9026139384",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g168",
        uid: "9028500887",
        followersValue: 178,
        followersDisplay: "178",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9028500887",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g169",
        uid: "7900435368",
        followersValue: 158,
        followersDisplay: "158",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7900435368",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g170",
        uid: "9059123321",
        followersValue: 1047,
        followersDisplay: "1047",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9059123321",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g171",
        uid: "8007185147",
        followersValue: 574,
        followersDisplay: "574",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8007185147",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g172",
        uid: "7944774134",
        followersValue: 1184,
        followersDisplay: "1184",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7944774134",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g173",
        uid: "4050449755",
        followersValue: 1297,
        followersDisplay: "1297",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4050449755",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g174",
        uid: "7996725814",
        followersValue: 1857,
        followersDisplay: "1857",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7996725814",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g175",
        uid: "4001823244",
        followersValue: 298,
        followersDisplay: "298",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4001823244",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g176",
        uid: "7880173933",
        followersValue: 6092,
        followersDisplay: "6092",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7880173933",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g177",
        uid: "7887741461",
        followersValue: 27859,
        followersDisplay: "27859",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7887741461",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g178",
        uid: "8378310629",
        followersValue: 862,
        followersDisplay: "862",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8378310629",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g179",
        uid: "7867305573",
        followersValue: 21932,
        followersDisplay: "21932",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7867305573",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g180",
        uid: "7986470900",
        followersValue: 6638,
        followersDisplay: "6638",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7986470900",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g181",
        uid: "5725783292",
        followersValue: 1178,
        followersDisplay: "1178",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5725783292",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g183",
        uid: "8250832430",
        followersValue: 9152,
        followersDisplay: "9152",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8250832430",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g184",
        uid: "7817642624",
        followersValue: 21211,
        followersDisplay: "21211",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7817642624",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g185",
        uid: "7878832463",
        followersValue: 7300,
        followersDisplay: "7300",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7878832463",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g186",
        uid: "7949143867",
        followersValue: 5776,
        followersDisplay: "5776",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7949143867",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g187",
        uid: "8299944268",
        followersValue: 1675,
        followersDisplay: "1675",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8299944268",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g189",
        uid: "7964144142",
        followersValue: 2771,
        followersDisplay: "2771",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7964144142",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g190",
        uid: "8009286150",
        followersValue: 1608,
        followersDisplay: "1608",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8009286150",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g191",
        uid: "7924392761",
        followersValue: 3846,
        followersDisplay: "3846",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7924392761",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g192",
        uid: "7987150865",
        followersValue: 5826,
        followersDisplay: "5826",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7987150865",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g193",
        uid: "5787034593",
        followersValue: 1006,
        followersDisplay: "1006",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5787034593",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g194",
        uid: "8008308204",
        followersValue: 2509,
        followersDisplay: "2509",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8008308204",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g197",
        uid: "8302077686",
        followersValue: 2277,
        followersDisplay: "2277",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8302077686",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g198",
        uid: "8005276891",
        followersValue: 2780,
        followersDisplay: "2780",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8005276891",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g199",
        uid: "9074808856",
        followersValue: 1066,
        followersDisplay: "1066",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9074808856",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g200",
        uid: "6185831573",
        followersValue: 512,
        followersDisplay: "512",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6185831573",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g201",
        uid: "8380788940",
        followersValue: 936,
        followersDisplay: "936",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8380788940",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g202",
        uid: "5217570283",
        followersValue: 1526,
        followersDisplay: "1526",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5217570283",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g203",
        uid: "5630615223",
        followersValue: 818,
        followersDisplay: "818",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5630615223",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g204",
        uid: "9007382970",
        followersValue: 4669,
        followersDisplay: "4669",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9007382970",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g205",
        uid: "9052165462",
        followersValue: 442,
        followersDisplay: "442",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9052165462",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g206",
        uid: "7324326901",
        followersValue: 1732,
        followersDisplay: "1732",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7324326901",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g207",
        uid: "9164818103",
        followersValue: 716,
        followersDisplay: "716",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9164818103",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g208",
        uid: "9173705600",
        followersValue: 313,
        followersDisplay: "313",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9173705600",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g209",
        uid: "8012026265",
        followersValue: 729,
        followersDisplay: "729",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8012026265",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g210",
        uid: "8276499473",
        followersValue: 59,
        followersDisplay: "59",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8276499473",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g211",
        uid: "8005107645",
        followersValue: 1418,
        followersDisplay: "1418",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8005107645",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g212",
        uid: "7904843031",
        followersValue: 24501,
        followersDisplay: "24501",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7904843031",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g213",
        uid: "7934555568",
        followersValue: 594,
        followersDisplay: "594",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7934555568",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g214",
        uid: "7951145216",
        followersValue: 16774,
        followersDisplay: "16774",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7951145216",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g215",
        uid: "7962270057",
        followersValue: 8937,
        followersDisplay: "8937",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7962270057",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g216",
        uid: "6118018183",
        followersValue: 64645,
        followersDisplay: "64645",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6118018183",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g217",
        uid: "7891075844",
        followersValue: 3971,
        followersDisplay: "3971",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7891075844",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g218",
        uid: "8358788113",
        followersValue: 970,
        followersDisplay: "970",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8358788113",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g219",
        uid: "7888575400",
        followersValue: 9996,
        followersDisplay: "9996",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7888575400",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g220",
        uid: "7989879715",
        followersValue: 3687,
        followersDisplay: "3687",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7989879715",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g221",
        uid: "7982217162",
        followersValue: 25173,
        followersDisplay: "25173",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7982217162",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g222",
        uid: "6120515559",
        followersValue: 2106,
        followersDisplay: "2106",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6120515559",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g223",
        uid: "6665190780",
        followersValue: 4162,
        followersDisplay: "4162",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6665190780",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g224",
        uid: "6381830574",
        followersValue: 24458,
        followersDisplay: "24458",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6381830574",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g225",
        uid: "7995648699",
        followersValue: 11419,
        followersDisplay: "11419",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7995648699",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g226",
        uid: "7987448968",
        followersValue: 2908,
        followersDisplay: "2908",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7987448968",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g227",
        uid: "7950254493",
        followersValue: 3402,
        followersDisplay: "3402",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7950254493",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g228",
        uid: "6988078086",
        followersValue: 1387,
        followersDisplay: "1387",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6988078086",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g229",
        uid: "5618456134",
        followersValue: 11493,
        followersDisplay: "11493",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5618456134",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g230",
        uid: "8354520188",
        followersValue: 2138,
        followersDisplay: "2138",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8354520188",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g231",
        uid: "8305787461",
        followersValue: 2018,
        followersDisplay: "2018",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8305787461",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g232",
        uid: "6973857941",
        followersValue: 1994,
        followersDisplay: "1994",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6973857941",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g233",
        uid: "9007588352",
        followersValue: 1434,
        followersDisplay: "1434",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9007588352",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g234",
        uid: "9135259251",
        followersValue: 1597,
        followersDisplay: "1597",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9135259251",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g235",
        uid: "8426292470",
        followersValue: 1358,
        followersDisplay: "1358",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8426292470",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g236",
        uid: "9041990664",
        followersValue: 747,
        followersDisplay: "747",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9041990664",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g237",
        uid: "8311293891",
        followersValue: 293,
        followersDisplay: "293",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8311293891",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g238",
        uid: "8219044702",
        followersValue: 539,
        followersDisplay: "539",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8219044702",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g239",
        uid: "9106003426",
        followersValue: 1021,
        followersDisplay: "1021",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9106003426",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g240",
        uid: "5045199818",
        followersValue: 606,
        followersDisplay: "606",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5045199818",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g241",
        uid: "7890413327",
        followersValue: 11007,
        followersDisplay: "11007",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7890413327",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g242",
        uid: "9000783543",
        followersValue: 217,
        followersDisplay: "217",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9000783543",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g243",
        uid: "7855996819",
        followersValue: 36604,
        followersDisplay: "36604",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7855996819",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g244",
        uid: "7879928465",
        followersValue: 72868,
        followersDisplay: "72868",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7879928465",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g245",
        uid: "7910606833",
        followersValue: 11909,
        followersDisplay: "11909",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7910606833",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g246",
        uid: "9189884086",
        followersValue: 588,
        followersDisplay: "588",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9189884086",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g247",
        uid: "7906178256",
        followersValue: 4775,
        followersDisplay: "4775",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7906178256",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g248",
        uid: "6517629246",
        followersValue: 14518,
        followersDisplay: "14518",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6517629246",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g249",
        uid: "6015467903",
        followersValue: 5189,
        followersDisplay: "5189",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6015467903",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g250",
        uid: "8400539613",
        followersValue: 2547,
        followersDisplay: "2547",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8400539613",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g251",
        uid: "4001816246",
        followersValue: 1589,
        followersDisplay: "1589",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4001816246",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g252",
        uid: "7756708043",
        followersValue: 672,
        followersDisplay: "672",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7756708043",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g253",
        uid: "8202187598",
        followersValue: 616,
        followersDisplay: "616",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8202187598",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g254",
        uid: "8297057509",
        followersValue: 398,
        followersDisplay: "398",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8297057509",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g255",
        uid: "9006970704",
        followersValue: 456,
        followersDisplay: "456",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9006970704",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g256",
        uid: "4017878407",
        followersValue: 13347,
        followersDisplay: "13347",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4017878407",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g257",
        uid: "7897562017",
        followersValue: 31219,
        followersDisplay: "31219",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7897562017",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g258",
        uid: "9018744049",
        followersValue: 897,
        followersDisplay: "897",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9018744049",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g259",
        uid: "8007166684",
        followersValue: 213,
        followersDisplay: "213",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8007166684",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g260",
        uid: "7942116602",
        followersValue: 6098,
        followersDisplay: "6098",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7942116602",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g261",
        uid: "5912245834",
        followersValue: 7680,
        followersDisplay: "7680",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5912245834",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g262",
        uid: "7957941312",
        followersValue: 1839,
        followersDisplay: "1839",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7957941312",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g263",
        uid: "8323024643",
        followersValue: 1197,
        followersDisplay: "1197",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8323024643",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g264",
        uid: "6379221815",
        followersValue: 219,
        followersDisplay: "219",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6379221815",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g265",
        uid: "8374875765",
        followersValue: 169,
        followersDisplay: "169",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8374875765",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g266",
        uid: "9144769703",
        followersValue: 1587,
        followersDisplay: "1587",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9144769703",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g267",
        uid: "7962191495",
        followersValue: 1984,
        followersDisplay: "1984",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7962191495",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g268",
        uid: "7972370966",
        followersValue: 413,
        followersDisplay: "413",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7972370966",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g269",
        uid: "7901912800",
        followersValue: 519,
        followersDisplay: "519",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7901912800",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g270",
        uid: "7608805247",
        followersValue: 330,
        followersDisplay: "330",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7608805247",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g271",
        uid: "7993106078",
        followersValue: 638,
        followersDisplay: "638",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7993106078",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g273",
        uid: "8324915182",
        followersValue: 801,
        followersDisplay: "801",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8324915182",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g274",
        uid: "8449359063",
        followersValue: 757,
        followersDisplay: "757",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8449359063",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g276",
        uid: "8250884334",
        followersValue: 409,
        followersDisplay: "409",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8250884334",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g277",
        uid: "9101048440",
        followersValue: 906,
        followersDisplay: "906",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9101048440",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g278",
        uid: "7964328842",
        followersValue: 276,
        followersDisplay: "276",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7964328842",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g279",
        uid: "5832918977",
        followersValue: 245,
        followersDisplay: "245",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5832918977",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g280",
        uid: "8339747729",
        followersValue: 1903,
        followersDisplay: "1903",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8339747729",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g281",
        uid: "7799685342",
        followersValue: 157,
        followersDisplay: "157",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7799685342",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g282",
        uid: "9090451515",
        followersValue: 60,
        followersDisplay: "60",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9090451515",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g283",
        uid: "5894189079",
        followersValue: 58,
        followersDisplay: "58",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5894189079",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g284",
        uid: "8302783574",
        followersValue: 921,
        followersDisplay: "921",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8302783574",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g285",
        uid: "7878734235",
        followersValue: 851,
        followersDisplay: "851",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7878734235",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g286",
        uid: "7985553689",
        followersValue: 2395,
        followersDisplay: "2395",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7985553689",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g287",
        uid: "4015701047",
        followersValue: 59,
        followersDisplay: "59",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4015701047",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g288",
        uid: "7790044856",
        followersValue: 67857,
        followersDisplay: "67857",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7790044856",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g289",
        uid: "7806371436",
        followersValue: 25372,
        followersDisplay: "25372",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7806371436",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g290",
        uid: "9076388739",
        followersValue: 1313,
        followersDisplay: "1313",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9076388739",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g291",
        uid: "9149752901",
        followersValue: 836,
        followersDisplay: "836",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9149752901",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g292",
        uid: "6942378993",
        followersValue: 916,
        followersDisplay: "916",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6942378993",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g293",
        uid: "7967400242",
        followersValue: 1456,
        followersDisplay: "1456",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7967400242",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g294",
        uid: "4079312714",
        followersValue: 358,
        followersDisplay: "358",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4079312714",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g295",
        uid: "4082812441",
        followersValue: 1329,
        followersDisplay: "1329",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4082812441",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g296",
        uid: "7913788678",
        followersValue: 750,
        followersDisplay: "750",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7913788678",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g297",
        uid: "9170211811",
        followersValue: 269,
        followersDisplay: "269",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9170211811",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g298",
        uid: "7843009600",
        followersValue: 20843,
        followersDisplay: "20843",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7843009600",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g299",
        uid: "9196498791",
        followersValue: 393,
        followersDisplay: "393",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9196498791",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g301",
        uid: "7988852586",
        followersValue: 2043,
        followersDisplay: "2043",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7988852586",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g302",
        uid: "7361396746",
        followersValue: 105,
        followersDisplay: "105",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7361396746",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g304",
        uid: "7994178497",
        followersValue: 1182,
        followersDisplay: "1182",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7994178497",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g305",
        uid: "8416016207",
        followersValue: 422,
        followersDisplay: "422",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8416016207",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g306",
        uid: "8233014677",
        followersValue: 281,
        followersDisplay: "281",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8233014677",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g307",
        uid: "7974691395",
        followersValue: 4301,
        followersDisplay: "4301",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7974691395",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g308",
        uid: "7989387284",
        followersValue: 533,
        followersDisplay: "533",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7989387284",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g310",
        uid: "7408614757",
        followersValue: 199,
        followersDisplay: "199",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7408614757",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g311",
        uid: "7989169134",
        followersValue: 202,
        followersDisplay: "202",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7989169134",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g312",
        uid: "8016590922",
        followersValue: 596,
        followersDisplay: "596",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8016590922",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g313",
        uid: "8445256957",
        followersValue: 513,
        followersDisplay: "513",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8445256957",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g314",
        uid: "7965987240",
        followersValue: 3851,
        followersDisplay: "3851",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7965987240",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g315",
        uid: "8349102691",
        followersValue: 133,
        followersDisplay: "133",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8349102691",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g316",
        uid: "9126342274",
        followersValue: 289,
        followersDisplay: "289",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9126342274",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g317",
        uid: "7826429328",
        followersValue: 79,
        followersDisplay: "79",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7826429328",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g318",
        uid: "9016017468",
        followersValue: 493,
        followersDisplay: "493",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9016017468",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g319",
        uid: "9025822334",
        followersValue: 118,
        followersDisplay: "118",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9025822334",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g320",
        uid: "7913279444",
        followersValue: 16708,
        followersDisplay: "16708",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7913279444",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g321",
        uid: "7799412963",
        followersValue: 19995,
        followersDisplay: "19995",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7799412963",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g322",
        uid: "7977650956",
        followersValue: 11353,
        followersDisplay: "11353",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7977650956",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g323",
        uid: "7947990990",
        followersValue: 587,
        followersDisplay: "587",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7947990990",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g324",
        uid: "8015773552",
        followersValue: 1625,
        followersDisplay: "1625",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8015773552",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g325",
        uid: "8482978123",
        followersValue: 1007,
        followersDisplay: "1007",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8482978123",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g326",
        uid: "6055700001",
        followersValue: 111,
        followersDisplay: "111",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6055700001",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g327",
        uid: "6785042369",
        followersValue: 95,
        followersDisplay: "95",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6785042369",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g328",
        uid: "7987525320",
        followersValue: 845,
        followersDisplay: "845",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7987525320",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g330",
        uid: "7965852533",
        followersValue: 5043,
        followersDisplay: "5043",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7965852533",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g331",
        uid: "7971083483",
        followersValue: 2275,
        followersDisplay: "2275",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7971083483",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g332",
        uid: "7980700514",
        followersValue: 1160,
        followersDisplay: "1160",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7980700514",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g333",
        uid: "8007150917",
        followersValue: 284,
        followersDisplay: "284",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/8007150917",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g334",
        uid: "8369396962",
        followersValue: 817,
        followersDisplay: "817",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8369396962",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g335",
        uid: "7908141478",
        followersValue: 221,
        followersDisplay: "221",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7908141478",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g336",
        uid: "9016168712",
        followersValue: 947,
        followersDisplay: "947",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9016168712",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g337",
        uid: "9108716034",
        followersValue: 178,
        followersDisplay: "178",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9108716034",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g338",
        uid: "7995516119",
        followersValue: 158,
        followersDisplay: "158",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7995516119",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g340",
        uid: "8015614786",
        followersValue: 250,
        followersDisplay: "250",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8015614786",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g341",
        uid: "8335452848",
        followersValue: 331,
        followersDisplay: "331",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8335452848",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g342",
        uid: "6122892285",
        followersValue: 40568,
        followersDisplay: "40568",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6122892285",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g343",
        uid: "7769117738",
        followersValue: 54205,
        followersDisplay: "54205",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7769117738",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g344",
        uid: "5974298181",
        followersValue: 1553,
        followersDisplay: "1553",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5974298181",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g346",
        uid: "7942408786",
        followersValue: 18328,
        followersDisplay: "18328",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7942408786",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g347",
        uid: "7990341300",
        followersValue: 5326,
        followersDisplay: "5326",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7990341300",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g348",
        uid: "7928551468",
        followersValue: 2097,
        followersDisplay: "2097",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7928551468",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g349",
        uid: "7923112825",
        followersValue: 5193,
        followersDisplay: "5193",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7923112825",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g350",
        uid: "4043751229",
        followersValue: 505,
        followersDisplay: "505",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4043751229",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g351",
        uid: "9135072641",
        followersValue: 300,
        followersDisplay: "300",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9135072641",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g352",
        uid: "8236973119",
        followersValue: 58,
        followersDisplay: "58",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8236973119",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g353",
        uid: "7719663101",
        followersValue: 25372,
        followersDisplay: "25372",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7719663101",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g354",
        uid: "7897193485",
        followersValue: 49175,
        followersDisplay: "49175",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7897193485",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g355",
        uid: "7840803514",
        followersValue: 6791,
        followersDisplay: "6791",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7840803514",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g356",
        uid: "4018607601",
        followersValue: 5644,
        followersDisplay: "5644",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/4018607601",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g357",
        uid: "6611437356",
        followersValue: 317,
        followersDisplay: "317",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6611437356",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g358",
        uid: "8315023911",
        followersValue: 1445,
        followersDisplay: "1445",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8315023911",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g359",
        uid: "6174007455",
        followersValue: 790,
        followersDisplay: "790",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6174007455",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g360",
        uid: "8257746955",
        followersValue: 539,
        followersDisplay: "539",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8257746955",
        slotId: "scheduled-2026-09-11",
        identityGate: "reviewed_account_scope",
        entityKind: "多团女子偶像企划",
        scopeNote: "NEOZ 是活跃于武汉的女子偶像企划总号，官号简介列出 NeoQ、初翼回响公学、X_ARCHIVE待归档、Rolipo。2026-07-06 的企划开启帖介绍各子团及武汉主催安排。此条按企划账号收录，粉丝与品牌图不代表旗下任何单团，也不将子团合照标成企划全员照。",
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g361",
        uid: "9133726646",
        followersValue: 316,
        followersDisplay: "316",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:24.005Z",
        sourceUrl: "https://weibo.com/u/9133726646",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "bdcc11ef34619d002052c8558cfc07c6077d511f6a5ed628192d0845814267bf"
      },
      {
        groupId: "g362",
        uid: "7477260439",
        followersValue: 3504,
        followersDisplay: "3504",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7477260439",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g363",
        uid: "6115028663",
        followersValue: 2914,
        followersDisplay: "2914",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/6115028663",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g364",
        uid: "8475410066",
        followersValue: 584,
        followersDisplay: "584",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8475410066",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g365",
        uid: "9002363102",
        followersValue: 361,
        followersDisplay: "361",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9002363102",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g366",
        uid: "7407471005",
        followersValue: 194,
        followersDisplay: "194",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7407471005",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g367",
        uid: "8389434959",
        followersValue: 147,
        followersDisplay: "147",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8389434959",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g368",
        uid: "8018446766",
        followersValue: 756,
        followersDisplay: "756",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8018446766",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g369",
        uid: "9024239746",
        followersValue: 480,
        followersDisplay: "480",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9024239746",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g370",
        uid: "7939975258",
        followersValue: 4250,
        followersDisplay: "4250",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7939975258",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g371",
        uid: "5990960722",
        followersValue: 11889,
        followersDisplay: "11889",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5990960722",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g372",
        uid: "7912259483",
        followersValue: 123,
        followersDisplay: "123",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7912259483",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g373",
        uid: "7849286331",
        followersValue: 25912,
        followersDisplay: "25912",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7849286331",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g374",
        uid: "7956631954",
        followersValue: 1850,
        followersDisplay: "1850",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7956631954",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g375",
        uid: "9036335035",
        followersValue: 371,
        followersDisplay: "371",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9036335035",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g376",
        uid: "7972735157",
        followersValue: 11567,
        followersDisplay: "11567",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7972735157",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g377",
        uid: "7098862480",
        followersValue: 3627,
        followersDisplay: "3627",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7098862480",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g378",
        uid: "8334299997",
        followersValue: 271,
        followersDisplay: "271",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8334299997",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g379",
        uid: "7915736629",
        followersValue: 9370,
        followersDisplay: "9370",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7915736629",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g380",
        uid: "7985248646",
        followersValue: 335,
        followersDisplay: "335",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7985248646",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g381",
        uid: "7915524608",
        followersValue: 168,
        followersDisplay: "168",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7915524608",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g382",
        uid: "5232796310",
        followersValue: 326,
        followersDisplay: "326",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/5232796310",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g383",
        uid: "7798439893",
        followersValue: 382,
        followersDisplay: "382",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7798439893",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g385",
        uid: "8015867014",
        followersValue: 66,
        followersDisplay: "66",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:18.154Z",
        sourceUrl: "https://weibo.com/u/8015867014",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "21cfb644651e1c45e160309d55805fdd62372a7692162ee2c34162f025fe3d4b"
      },
      {
        groupId: "g386",
        uid: "3198751751",
        followersValue: 450,
        followersDisplay: "450",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/3198751751",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g387",
        uid: "7923353052",
        followersValue: 2024,
        followersDisplay: "2024",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7923353052",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g388",
        uid: "7446728986",
        followersValue: 861,
        followersDisplay: "861",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7446728986",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g389",
        uid: "8424533903",
        followersValue: 246,
        followersDisplay: "246",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8424533903",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g391",
        uid: "8411080688",
        followersValue: 779,
        followersDisplay: "779",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/8411080688",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g392",
        uid: "7961197936",
        followersValue: 227,
        followersDisplay: "227",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:12.142Z",
        sourceUrl: "https://weibo.com/u/7961197936",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "6149c511d05fd20704a3f3340e14a2272972e198381ac70cb32f62af68572597"
      },
      {
        groupId: "g393",
        uid: "7981374360",
        followersValue: 396,
        followersDisplay: "396",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:15.273Z",
        sourceUrl: "https://weibo.com/u/7981374360",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "1fa0c9d750c9bdad30320a05fcaa9f26a7b69157f6729d1d8e2583da4e1e47d7"
      },
      {
        groupId: "g394",
        uid: "6579150992",
        followersValue: 2094,
        followersDisplay: "2094",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6579150992",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g395",
        uid: "7815740021",
        followersValue: 504,
        followersDisplay: "504",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:27.764Z",
        sourceUrl: "https://weibo.com/u/7815740021",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "2d1f2a54f9e83566e18e6920b964af9b591850065d046bfbda4d198fb4131d7b"
      },
      {
        groupId: "g397",
        uid: "9002535946",
        followersValue: 4810,
        followersDisplay: "4810",
        followersApproximate: false,
        followersObservedAt: "2026-09-11T03:20:21.237Z",
        sourceUrl: "https://weibo.com/u/9002535946",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "d26397e389ecb659e2863ff95ad5475f413767b6627711a431ec67a1961c9f60"
      },
      {
        groupId: "g398",
        uid: "3509789184",
        followersValue: 188,
        followersDisplay: "188",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:22.581Z",
        sourceUrl: "https://weibo.com/u/3509789184",
        slotId: "scheduled-2026-09-11",
        identityGate: "accepted_candidate",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "34309dce339f6f01dd990444ccb89903547ca5311eea2d79b87ad5f7d044bfe5"
      },
      {
        groupId: "g399",
        uid: "6748558554",
        followersValue: 994,
        followersDisplay: "994",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/6748558554",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      },
      {
        groupId: "g400",
        uid: "7552129288",
        followersValue: 1728,
        followersDisplay: "1728",
        followersApproximate: false,
        followersObservedAt: "2026-09-10T16:01:25.176Z",
        sourceUrl: "https://weibo.com/u/7552129288",
        slotId: "scheduled-2026-09-11",
        identityGate: "strict_uid_match",
        entityKind: "团体账号",
        scopeNote: null,
        responseSha256: "4f6386f8e6e74e52c11b266dbbad391f345abfc753524d47419bd8a9344010a2"
      }
    ]
  };

  // src/catalog/followerObservations.ts
  function emptyFollowerObservations() {
    return {
      schemaVersion: "idol-follower-observations-v1",
      updatedAt: null,
      records: []
    };
  }
  function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function observationTime(value, now) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/u.exec(
      value
    );
    const time = Date.parse(value);
    const day = match ? /* @__PURE__ */ new Date(`${match[1]}T00:00:00Z`) : null;
    return match && day && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] && Number.isFinite(time) && Number.isFinite(now.getTime()) && time <= now.getTime() ? time : null;
  }
  function observationWeek(value) {
    const date = new Date(Date.parse(value) + 8 * 36e5);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return `week-${date.toISOString().slice(0, 10)}`;
  }
  function strictFollowerIdentity(group, uid) {
    if (!object(group) || !/^\d{4,20}$/u.test(uid)) return false;
    const fields = group.fieldEvidence;
    const identity = object(fields) ? fields.profileIdentity : null;
    return String(group.weiboUid ?? "") === uid && group.uidConfidence === "high" && object(identity) && identity.state === "verified" && identity.confidence === "high" && String(identity.candidateUid ?? "") === uid && !(Array.isArray(group.rejectedIdentityCandidates) && group.rejectedIdentityCandidates.some(
      (item) => object(item) && String(item.uid) === uid
    ));
  }
  function latestFollowerBaseline(sources, now) {
    const points = [];
    const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const add = (value, approximate, observedAt) => {
      const time = observationTime(observedAt, now);
      if (!count(value) || time === null || typeof observedAt !== "string")
        return;
      points.push({
        value,
        approximate: typeof approximate === "boolean" ? approximate : null,
        observedAt,
        time
      });
    };
    for (const source of sources) {
      if (!object(source)) continue;
      const fields = source.fieldEvidence;
      const evidence = object(fields) && object(fields.followers) ? fields.followers : null;
      const uid = String(source.weiboUid ?? source.uid ?? "");
      const evidenceMatches = evidence && !["blocked", "conflict", "not_found"].includes(String(evidence.state)) && (evidence.boundUid == null || String(evidence.boundUid) === uid);
      if (source.followersKnown !== false && count(source.followersValue)) {
        const times = [source.followersObservedAt];
        if (observationTime(source.followersObservedAt, now) === null) {
          times.push(source.profileObservedAt);
          if (evidenceMatches && (evidence.numericValue == null || evidence.numericValue === source.followersValue))
            times.push(evidence.observedAt);
        }
        for (const time of times)
          add(source.followersValue, source.followersApproximate, time);
      }
      if (evidenceMatches && evidence.state === "verified") {
        add(
          evidence.numericValue,
          evidence.followersApproximate ?? (evidence.numericValue === source.followersValue ? source.followersApproximate : null),
          evidence.observedAt
        );
      }
      const review = source.publicReview;
      const profile = object(review) ? review.profile : null;
      if (object(profile) && String(profile.uid ?? "") === uid && profile.followersValue === source.followersValue)
        add(
          profile.followersValue,
          profile.followersApproximate,
          profile.observedAt
        );
    }
    points.sort((a, b) => b.time - a.time);
    const latest = points[0];
    return latest ? {
      ...latest,
      conflict: points.some(
        (point) => point.time === latest.time && (point.value !== latest.value || point.approximate !== latest.approximate)
      )
    } : null;
  }
  var keys = [
    "groupId",
    "uid",
    "followersValue",
    "followersDisplay",
    "followersApproximate",
    "followersObservedAt",
    "sourceUrl",
    "weekId",
    "identityGate",
    "responseSha256"
  ];
  function exactKeys(value, allowed) {
    return Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
  }
  function validateFollowerObservations(input, now = /* @__PURE__ */ new Date()) {
    const errors = [];
    if (!object(input) || !exactKeys(input, ["schemaVersion", "updatedAt", "records"]) || input.schemaVersion !== "idol-follower-observations-v1" || !Array.isArray(input.records))
      return { valid: false, errors: ["invalid_follower_dataset"] };
    const ids = /* @__PURE__ */ new Set();
    const uids = /* @__PURE__ */ new Set();
    let latest = null;
    for (const [index, record] of input.records.entries()) {
      if (!object(record) || !exactKeys(record, keys) || typeof record.groupId !== "string" || !/^g\d{3,8}$/u.test(record.groupId) || typeof record.uid !== "string" || !/^\d{4,20}$/u.test(record.uid) || typeof record.followersValue !== "number" || !Number.isSafeInteger(record.followersValue) || record.followersValue < 0 || typeof record.followersApproximate !== "boolean" || typeof record.followersDisplay !== "string" || record.followersDisplay !== `${record.followersApproximate ? "约" : ""}${record.followersValue}` || observationTime(record.followersObservedAt, now) === null || record.sourceUrl !== `https://weibo.com/u/${record.uid}` || record.identityGate !== "strict_uid_match" || typeof record.responseSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.responseSha256)) {
        errors.push(`invalid_follower_record:${index}`);
        continue;
      }
      const observed = record.followersObservedAt;
      if (record.weekId !== observationWeek(observed))
        errors.push(`observation_week_mismatch:${index}`);
      if (ids.has(record.groupId) || uids.has(record.uid))
        errors.push(`duplicate_follower_identity:${index}`);
      ids.add(record.groupId);
      uids.add(record.uid);
      if (latest === null || Date.parse(observed) > Date.parse(latest))
        latest = observed;
    }
    if (input.updatedAt !== latest) errors.push("invalid_follower_updated_at");
    return errors.length ? { valid: false, errors } : {
      valid: true,
      data: structuredClone(input),
      errors: []
    };
  }

  // src/catalog/scopedFollowerObservations.ts
  function emptyScopedFollowerObservations() {
    return {
      schemaVersion: "idol-follower-observations-v2",
      updatedAt: null,
      records: []
    };
  }
  var REVIEWED_SCOPES = Object.freeze({
    g060: "2030310713",
    g360: "8257746955"
  });
  var RECORD_KEYS = [
    "groupId",
    "uid",
    "followersValue",
    "followersDisplay",
    "followersApproximate",
    "followersObservedAt",
    "sourceUrl",
    "slotId",
    "identityGate",
    "entityKind",
    "scopeNote",
    "responseSha256"
  ];
  function exactKeys2(value, keys2) {
    return Object.keys(value).length === keys2.length && keys2.every((key) => Object.hasOwn(value, key));
  }
  function publicText(value, limit) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[<>]/u.test(value) && [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    });
  }
  function observationSlotMatches(observedAt, slotId) {
    const time = Date.parse(observedAt);
    const firstScheduledTime = Date.parse("2026-09-11T00:00:00+08:00");
    if (slotId.startsWith("manual-"))
      return slotId === "manual-2026-09-09" && time >= Date.parse("2026-09-09T00:00:00+08:00") && time < firstScheduledTime;
    const date = new Date(time + 8 * 36e5);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 2) % 7);
    return time >= firstScheduledTime && slotId === `scheduled-${date.toISOString().slice(0, 10)}`;
  }
  function validateScopedFollowerObservations(input, now = /* @__PURE__ */ new Date()) {
    if (!object(input) || !exactKeys2(input, ["schemaVersion", "updatedAt", "records"]) || input.schemaVersion !== "idol-follower-observations-v2" || !Array.isArray(input.records))
      return { valid: false, errors: ["invalid_scoped_follower_dataset"] };
    const errors = [];
    const ids = /* @__PURE__ */ new Set();
    const uids = /* @__PURE__ */ new Set();
    let latest = null;
    for (const [index, record] of input.records.entries()) {
      if (!object(record) || !exactKeys2(record, RECORD_KEYS) || typeof record.groupId !== "string" || !/^g\d{3,8}$/u.test(record.groupId) || typeof record.uid !== "string" || !/^\d{4,20}$/u.test(record.uid) || typeof record.followersValue !== "number" || !Number.isSafeInteger(record.followersValue) || record.followersValue < 0 || typeof record.followersApproximate !== "boolean" || record.followersDisplay !== `${record.followersApproximate ? "约" : ""}${record.followersValue}` || observationTime(record.followersObservedAt, now) === null || record.sourceUrl !== `https://weibo.com/u/${record.uid}` || typeof record.slotId !== "string" || !/^(manual|scheduled)-\d{4}-\d{2}-\d{2}$/u.test(record.slotId) || typeof record.identityGate !== "string" || ![
        "strict_uid_match",
        "accepted_candidate",
        "reviewed_account_scope"
      ].includes(record.identityGate) || (record.identityGate === "reviewed_account_scope" ? REVIEWED_SCOPES[record.groupId] !== record.uid || !publicText(record.entityKind, 100) || !publicText(record.scopeNote, 2e3) : record.entityKind !== "团体账号" || record.scopeNote !== null) || typeof record.responseSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(record.responseSha256)) {
        errors.push(`invalid_scoped_follower_record:${index}`);
        continue;
      }
      const observed = record.followersObservedAt;
      if (!observationSlotMatches(observed, record.slotId))
        errors.push(`observation_slot_mismatch:${index}`);
      if (ids.has(record.groupId) || uids.has(record.uid))
        errors.push(`duplicate_follower_identity:${index}`);
      ids.add(record.groupId);
      uids.add(record.uid);
      if (latest === null || Date.parse(observed) > Date.parse(latest))
        latest = observed;
    }
    if (input.updatedAt !== latest) errors.push("invalid_follower_updated_at");
    return errors.length ? { valid: false, errors } : {
      valid: true,
      data: structuredClone(input),
      errors: []
    };
  }
  function scopedFollowerIdentity(group, record) {
    if (!object(group) || group.id !== record.groupId || String(group.weiboUid ?? "") !== record.uid || group.uidConfidence !== "high" || group.profileUrl !== record.sourceUrl)
      return false;
    const supplement = group.editorialProfileSupplement;
    if (record.identityGate === "reviewed_account_scope") {
      const review = group.publicReview;
      return REVIEWED_SCOPES[record.groupId] === record.uid && group.uidSource === "public_reviewed_account_scope" && object(review) && review.id === group.id && review.expectedHandle === group.handle && review.entityKind === record.entityKind && review.summary === record.scopeNote && object(review.profile) && String(review.profile.uid ?? "") === record.uid && review.profile.sourceUrl === record.sourceUrl;
    }
    if (record.entityKind !== "团体账号" || record.scopeNote !== null || group.uidSource === "public_reviewed_account_scope" || Array.isArray(group.rejectedIdentityCandidates) && group.rejectedIdentityCandidates.some(
      (candidate) => object(candidate) && String(candidate.uid) === record.uid
    ))
      return false;
    if (record.identityGate === "accepted_candidate")
      return group.uidSource === "editorial_profile_supplement" && object(supplement) && supplement.state === "accepted_candidate" && String(supplement.uid ?? "") === record.uid && supplement.profileUrl === record.sourceUrl && Array.isArray(supplement.appliedFields) && supplement.appliedFields.includes("identity");
    return record.identityGate === "strict_uid_match" && group.uidSource !== "editorial_profile_supplement" && !(object(supplement) && supplement.state === "accepted_candidate") && strictFollowerIdentity(group, record.uid);
  }
  function sameFollowerValue(left, right) {
    return left.followersValue === right.followersValue && left.followersApproximate === right.followersApproximate;
  }
  function scopedFollowerBaselineSources(group) {
    if (!object(group)) return [];
    const sources = [group];
    const uid = String(group.weiboUid ?? group.uid ?? "");
    if (!/^\d{4,20}$/u.test(uid)) return structuredClone(sources);
    const review = group.publicReview;
    const snapshot = group.strictSnapshot;
    const profile = object(snapshot) ? snapshot.profile : null;
    const matches = (source) => object(source) && String(source.weiboUid ?? source.uid ?? "") === uid;
    for (const source of [
      group.followerObservation,
      object(review) ? review.profile : null,
      profile
    ])
      if (matches(source))
        sources.push({
          ...source,
          followersObservedAt: source.followersObservedAt ?? source.profileObservedAt ?? source.observedAt
        });
    const supplement = group.editorialProfileSupplement;
    if (matches(supplement) && supplement.state === "accepted_candidate" && Array.isArray(supplement.appliedFields) && supplement.appliedFields.includes("followers"))
      sources.push({ ...supplement, followersObservedAt: supplement.observedAt });
    const evidence = object(profile) ? profile.followerEvidence : null;
    if (matches(profile) && object(evidence) && evidence.state === "verified" && String(evidence.boundUid ?? "") === uid)
      sources.push({
        uid,
        fieldEvidence: {
          followers: {
            ...evidence,
            followersApproximate: evidence.followersApproximate ?? evidence.approximate ?? (evidence.numericValue === profile.followersValue ? profile.followersApproximate : null)
          }
        }
      });
    return structuredClone(sources);
  }
  function futureBaseline(source, now) {
    if (!object(source)) return false;
    const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    const future = (value) => typeof value === "string" && Date.parse(value) > now.getTime();
    if (source.followersKnown !== false && count(source.followersValue) && future(source.followersObservedAt ?? source.profileObservedAt))
      return true;
    const fields = source.fieldEvidence;
    const evidence = object(fields) ? fields.followers : null;
    return object(evidence) && evidence.state === "verified" && (evidence.boundUid == null || String(evidence.boundUid) === String(source.weiboUid ?? source.uid ?? "")) && count(evidence.numericValue) && future(evidence.observedAt);
  }
  function overlayCombinedFollowerObservations(groups, legacyInput = emptyFollowerObservations(), scopedInput = emptyScopedFollowerObservations(), now = /* @__PURE__ */ new Date(), mode = "current") {
    const legacy = validateFollowerObservations(legacyInput, now);
    if (!legacy.valid) throw new Error(legacy.errors.join(","));
    const scoped = validateScopedFollowerObservations(scopedInput, now);
    if (!scoped.valid) throw new Error(scoped.errors.join(","));
    const byGroup = new Map(groups.map((group) => [group.id, group]));
    if (byGroup.size !== groups.length)
      throw new Error("duplicate_display_group_id");
    const latest = /* @__PURE__ */ new Map();
    for (const record of [...legacy.data.records, ...scoped.data.records]) {
      const group = byGroup.get(record.groupId);
      if (!group || !("slotId" in record ? scopedFollowerIdentity(group, record) : strictFollowerIdentity(group, record.uid)) || groups.filter(
        (candidate) => object(candidate) && String(candidate.weiboUid ?? "") === record.uid
      ).length !== 1)
        throw new Error(`display_identity_mismatch:${record.groupId}`);
      const previous = latest.get(record.groupId);
      if (previous) {
        if (previous.uid !== record.uid)
          throw new Error(`display_identity_mismatch:${record.groupId}`);
        const difference = Date.parse(record.followersObservedAt) - Date.parse(previous.followersObservedAt);
        if (difference === 0 && !sameFollowerValue(previous, record))
          throw new Error(`follower_same_time_conflict:${record.groupId}`);
        if (difference < 0) continue;
      }
      latest.set(record.groupId, record);
    }
    for (const [id, record] of latest) {
      const sources = scopedFollowerBaselineSources(byGroup.get(id));
      if (sources.some((source) => futureBaseline(source, now)))
        throw new Error(`follower_future_baseline:${id}`);
      const baseline = latestFollowerBaseline(sources, now);
      if (!baseline) continue;
      if (baseline.conflict)
        throw new Error(`follower_baseline_observation_conflict:${id}`);
      const time = Date.parse(record.followersObservedAt);
      if (time < baseline.time)
        throw new Error(`follower_older_observation:${id}`);
      if (time === baseline.time && (record.followersValue !== baseline.value || record.followersApproximate !== baseline.approximate))
        throw new Error(`follower_same_time_conflict:${id}`);
    }
    return groups.map((group) => {
      const copy = structuredClone(group);
      const record = latest.get(group.id);
      if (!record) return copy;
      if (mode === "archive")
        return Object.assign(copy, {
          followerObservation: structuredClone(record)
        });
      return Object.assign(copy, {
        followersValue: record.followersValue,
        followersDisplay: record.followersDisplay,
        followersApproximate: record.followersApproximate,
        followersObservedAt: record.followersObservedAt,
        followersKnown: true,
        followersText: record.followersDisplay,
        followerObservation: structuredClone(record)
      });
    });
  }

  // src/events/model.ts
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  var ID_PATTERN = /^e-[a-z0-9-]+$/;
  var UTC8_MS = 8 * 60 * 60 * 1e3;
  var DAY_MS = 24 * 60 * 60 * 1e3;
  var STATUS_LABELS = {
    scheduled: "计划举行",
    postponed: "已延期，请核实新日期",
    cancelled: "已取消",
    unconfirmed: "安排待确认"
  };
  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isDate(value) {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
    if (value.startsWith("0000-")) return false;
    const parsed = /* @__PURE__ */ new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  function isTimestamp(value) {
    if (typeof value !== "string") return false;
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(
      value
    );
    if (!match || match[0] !== value || !isDate(match[1])) return false;
    const offset = match[5];
    if (offset && /^[+-]14:/.test(offset) && !offset.endsWith(":00"))
      return false;
    return Number.isFinite(Date.parse(value));
  }
  function isSafeUrl(value) {
    if (typeof value !== "string" || value.length > 2048) return false;
    if (!/^https?:\/\//i.test(value) || // eslint-disable-next-line no-control-regex -- 安全边界需要明确拒绝 URL 中的控制字符。
    /[\s\\\u0000-\u001f\u007f]|%0[ad]/i.test(value))
      return false;
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  function isLocalEventPosterPath(value) {
    return typeof value === "string" && value.trim() === value && /^assets\/event-posters\/[a-z0-9][a-z0-9_-]{0,95}\.(?:png|jpe?g|webp)$/.test(
      value
    );
  }
  function validateEventDataset(input, knownGroupIds) {
    const errors = [];
    const knownIds = new Set(knownGroupIds);
    const ids = /* @__PURE__ */ new Set();
    const fail = (path, message) => {
      errors.push({ path, message });
    };
    const shape = (value, path, keys2) => {
      if (!isObject(value)) {
        fail(path, "必须为对象");
        return false;
      }
      for (const key of keys2) {
        if (!Object.prototype.hasOwnProperty.call(value, key))
          fail(`${path}.${key}`, "缺少必需字段");
      }
      for (const key of Object.keys(value)) {
        if (!keys2.includes(key)) fail(`${path}.${key}`, "不接受未定义字段");
      }
      return true;
    };
    const text = (value, path, max, nullable = false, empty = false) => {
      if (nullable && value === null) return;
      if (typeof value !== "string" || !empty && !value.trim() || typeof value === "string" && [...value].length > max) {
        fail(
          path,
          `必须为${nullable ? " null 或" : ""}${empty ? "" : "非空"}字符串，最多 ${max} 字符`
        );
      }
    };
    if (!shape(input, "$", ["schemaVersion", "updatedAt", "coverage", "events"]))
      return { valid: false, errors };
    if (input.schemaVersion !== "idol-events-v1")
      fail("$.schemaVersion", "不支持的数据版本");
    if (input.coverage !== "partial")
      fail("$.coverage", "必须明确为 partial，不能声称完整覆盖");
    if (!isTimestamp(input.updatedAt))
      fail("$.updatedAt", "必须为含明确时区的有效 ISO 时间");
    if (!Array.isArray(input.events) || input.events.length > 1e4) {
      fail("$.events", "必须为最多 10000 条记录的数组");
      return { valid: false, errors };
    }
    Array.from(input.events).forEach((event, index) => {
      const p = `$.events[${index}]`;
      if (!shape(event, p, [
        "id",
        "title",
        "date",
        "province",
        "city",
        "venue",
        "address",
        "opensAt",
        "startsAt",
        "endsAt",
        "status",
        "performers",
        "sources",
        "notes",
        "poster"
      ]))
        return;
      if (typeof event.id !== "string" || event.id.trim() !== event.id || !ID_PATTERN.test(event.id) || event.id.length > 100) {
        fail(`${p}.id`, "活动 ID 格式无效或超过 100 字符");
      } else if (ids.has(event.id)) {
        fail(`${p}.id`, "活动 ID 重复");
      } else {
        ids.add(event.id);
      }
      text(event.title, `${p}.title`, 160);
      if (!isDate(event.date)) fail(`${p}.date`, "必须为真实日历日期 YYYY-MM-DD");
      for (const field of ["province", "city"]) {
        text(event[field], `${p}.${field}`, 40, true);
        if (typeof event[field] === "string" && (event[field].trim() !== event[field] || !/^[\p{Script=Han}·]+$/u.test(event[field]))) {
          fail(`${p}.${field}`, "省市须使用中文名称；未知时填写 null");
        }
      }
      text(event.venue, `${p}.venue`, 240, true);
      text(event.address, `${p}.address`, 500, true);
      text(event.notes, `${p}.notes`, 4e3, false, true);
      for (const field of ["opensAt", "startsAt", "endsAt"]) {
        if (event[field] !== null && (typeof event[field] !== "string" || event[field].trim() !== event[field] || !TIME_PATTERN.test(event[field]))) {
          fail(`${p}.${field}`, "必须为 HH:mm 或 null，不支持自行推断跨日时间");
        }
      }
      if (typeof event.opensAt === "string" && typeof event.startsAt === "string" && event.opensAt > event.startsAt) {
        fail(`${p}.opensAt`, "入场不能晚于同日开演；跨日信息请留空并备注");
      }
      if (typeof event.startsAt === "string" && typeof event.endsAt === "string" && event.endsAt <= event.startsAt) {
        fail(`${p}.endsAt`, "结束必须晚于同日开演；跨日信息请留空并备注");
      }
      if (typeof event.status !== "string" || !Object.prototype.hasOwnProperty.call(STATUS_LABELS, event.status)) {
        fail(`${p}.status`, "无效的活动状态");
      }
      if (!Array.isArray(event.performers) || event.performers.length > 200) {
        fail(`${p}.performers`, "必须为最多 200 项的数组");
      } else {
        Array.from(event.performers).forEach((performer, i) => {
          const pp = `${p}.performers[${i}]`;
          if (!shape(performer, pp, ["groupId", "name"])) return;
          text(performer.name, `${pp}.name`, 160);
          if (performer.groupId !== null && (typeof performer.groupId !== "string" || !knownIds.has(performer.groupId))) {
            fail(
              `${pp}.groupId`,
              "团体 ID 必须来自当前完整主档；未绑定时填 null"
            );
          }
        });
      }
      if (!Array.isArray(event.sources) || !event.sources.length || event.sources.length > 30) {
        fail(`${p}.sources`, "必须有 1 至 30 项可追溯来源");
      } else {
        Array.from(event.sources).forEach((source, i) => {
          const sp = `${p}.sources[${i}]`;
          if (!shape(source, sp, [
            "url",
            "label",
            "publisher",
            "observedAt",
            "kind"
          ]))
            return;
          if (!isSafeUrl(source.url))
            fail(`${sp}.url`, "必须为安全的绝对 HTTP(S) URL");
          text(source.label, `${sp}.label`, 240);
          text(source.publisher, `${sp}.publisher`, 160);
          if (!isTimestamp(source.observedAt))
            fail(`${sp}.observedAt`, "必须为含明确时区的有效观察时间");
          if (typeof source.kind !== "string" || ![
            "official",
            "organizer",
            "venue",
            "wiki",
            "aggregator",
            "ticketing"
          ].includes(source.kind))
            fail(`${sp}.kind`, "来源种类无效");
        });
      }
      if (event.poster !== null && shape(event.poster, `${p}.poster`, ["src", "alt", "sourceUrl"])) {
        if (!isSafeUrl(event.poster.src) && !isLocalEventPosterPath(event.poster.src))
          fail(
            `${p}.poster.src`,
            "海报必须为安全 URL 或 assets/event-posters 下的 PNG/JPEG/WebP 图片"
          );
        text(event.poster.alt, `${p}.poster.alt`, 240);
        if (!isSafeUrl(event.poster.sourceUrl))
          fail(`${p}.poster.sourceUrl`, "海报必须有安全来源 URL");
      }
    });
    if (errors.length) return { valid: false, errors };
    return { valid: true, data: input, errors: [] };
  }
  function filterEvents(events, filters) {
    const { from = "", to = "", group = "", province = [], city = [] } = filters;
    if (from && !isDate(from) || to && !isDate(to) || from && to && from > to)
      return [];
    const normalize = (value) => value.normalize("NFKC").toLowerCase();
    const terms = normalize(filters.q ?? "").trim().split(/\s+/).filter(Boolean);
    return events.filter((event) => {
      if (from && event.date < from || to && event.date > to) return false;
      if (group && !event.performers.some((performer) => performer.groupId === group))
        return false;
      if ((province.length || city.length) && !(event.province !== null && province.includes(event.province)) && !(event.city !== null && city.includes(event.city)))
        return false;
      const haystack = normalize(
        [
          event.title,
          event.province,
          event.city,
          event.venue,
          event.address,
          event.notes,
          ...event.performers.map((performer) => performer.name)
        ].filter((value) => value !== null).join(" ")
      );
      return terms.every((term) => haystack.includes(term));
    });
  }
  function getEventTemporalState(event, now) {
    if (!isDate(event.date) || !Number.isFinite(now.getTime()))
      throw new RangeError("日期或当前时间无效");
    const local = new Date(now.getTime() + UTC8_MS);
    if (!Number.isFinite(local.getTime()) || local.getUTCFullYear() < 1 || local.getUTCFullYear() > 9999) {
      throw new RangeError("当前时间超出可支持年份");
    }
    const today = local.toISOString().slice(0, 10);
    return event.date < today ? "past" : event.date > today ? "upcoming" : "today";
  }

  // src/site/map.ts
  function parseGroupLink(search, knownGroupIds) {
    if (search.length > 2048) return { state: "invalid" };
    const values = new URLSearchParams(search).getAll("group");
    if (values.length === 0) return { state: "none" };
    if (values.length !== 1 || !/^g\d{3}$/.test(values[0]) || !knownGroupIds.has(values[0])) {
      return { state: "invalid" };
    }
    return { state: "valid", groupId: values[0] };
  }
  function groupEventsHref(groupId) {
    return `events.html?group=${encodeURIComponent(groupId)}`;
  }
  function getGroupActivitySummary(events, groupId, now) {
    const related = filterEvents(events, { group: groupId });
    const upcoming = related.filter((event) => getEventTemporalState(event, now) !== "past").sort(
      (a, b) => a.date.localeCompare(b.date) || (a.startsAt || "99:99").localeCompare(b.startsAt || "99:99") || a.id.localeCompare(b.id)
    );
    const message = related.length === 0 ? "尚未收录相关活动，不代表该团没有活动。" : upcoming.length === 0 ? `已收录 ${related.length} 条日期已过的活动资料，尚未收录近期安排；日期经过不代表实际举办。` : `近期收录 ${upcoming.length} 条活动资料，以下最多显示 3 条。资料为部分收录，出发前请核对官宣及变更。`;
    return {
      total: related.length,
      upcomingCount: upcoming.length,
      upcoming: upcoming.slice(0, 3),
      message
    };
  }
  function renderGroupEvents(groupId) {
    const section = document.querySelector("#group-events");
    const link = document.querySelector("#group-events-link");
    const summary = document.querySelector("#group-events-summary");
    const list = document.querySelector("#group-events-list");
    if (!section || !link || !summary || !list) return;
    section.hidden = false;
    link.href = `${groupEventsHref(groupId)}&period=all`;
    const profile = document.querySelector(
      "#group-profile-link"
    );
    const correction = document.querySelector(
      "#group-correction-link"
    );
    if (profile) profile.href = `group.html?group=${encodeURIComponent(groupId)}`;
    if (correction)
      correction.href = `contribute.html?group=${encodeURIComponent(groupId)}&page=index&kind=error`;
    list.replaceChildren();
    list.hidden = true;
    const groups = window.IDOL_MAP_DATA?.groups;
    const validation = validateEventDataset(
      events_v1_default,
      groups?.map((group) => group.id) ?? []
    );
    if (!validation.valid) {
      summary.textContent = "活动资料校验失败，暂时不能显示摘要；请进入活动日历查看状态。";
      return;
    }
    const result = getGroupActivitySummary(
      validation.data.events,
      groupId,
      /* @__PURE__ */ new Date()
    );
    summary.textContent = result.message;
    const statuses = {
      scheduled: "计划举行",
      cancelled: "已取消",
      postponed: "已延期，请核对新安排",
      unconfirmed: "待确认，请核对官宣"
    };
    for (const event of result.upcoming) {
      const item = document.createElement("li");
      const eventLink = document.createElement("a");
      eventLink.href = `${groupEventsHref(groupId)}#${encodeURIComponent(event.id)}`;
      eventLink.textContent = `${event.date} · ${event.title}`;
      const note = document.createElement("p");
      note.textContent = `${statuses[event.status]} · ${event.startsAt ? `开演 ${event.startsAt}（UTC+8）` : "开演时间待公布"}`;
      item.append(eventLink, note);
      list.append(item);
    }
    list.hidden = result.upcoming.length === 0;
  }
  if (typeof window !== "undefined") {
    const holder = window;
    if (holder.IDOL_MAP_DATA?.groups) {
      try {
        holder.IDOL_MAP_DATA = {
          ...holder.IDOL_MAP_DATA,
          groups: overlayCombinedFollowerObservations(
            holder.IDOL_MAP_DATA.groups,
            follower_observations_v1_default,
            follower_observations_v2_default,
            /* @__PURE__ */ new Date(),
            "archive"
          )
        };
      } catch {
        holder.IDOL_FOLLOWER_LAYER_ERROR = true;
      }
    }
    window.IDOL_SITE = { parseGroupLink, groupEventsHref, renderGroupEvents };
  }
})();

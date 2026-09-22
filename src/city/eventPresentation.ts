import eventInput from "../../data/events.v1.json";
import verificationInput from "../../data/event-verifications.v1.json";
import { readCatalog } from "../catalog/runtime";
import { validateEventDataset, type EventRecord } from "../events/model";
import {
  eventFieldLabel,
  getEventVerification,
  validateEventVerificationDataset,
  type EventVerificationDataset,
  type VerificationField,
} from "../events/verification";

let verification: EventVerificationDataset | null | undefined;
/** 复用 A 核验规则；缺失或失配时只显示尚未核实，绝不推断尚未公布。 */
export function presentedEventField(
  event: EventRecord,
  field: VerificationField,
): string {
  if (verification === undefined) {
    const catalog = readCatalog();
    const events = validateEventDataset(
      eventInput,
      catalog.valid ? catalog.data.groups.map((group) => group.id) : [],
    );
    const result = events.valid
      ? validateEventVerificationDataset(verificationInput, events.data.events)
      : null;
    verification = result?.valid ? result.data : null;
  }
  return eventFieldLabel(
    event,
    verification ? getEventVerification(verification, event.id) : undefined,
    field,
  );
}

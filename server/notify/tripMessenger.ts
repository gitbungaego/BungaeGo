import { getTripParticipants, type ParticipantFilter, type TripParticipant } from "../participants";

export interface TripMessage {
  title: string;
  body: string;
}

function formatKoDateTime(date: Date): string {
  return date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

interface ReservationConfirmedParams {
  passengerName: string;
  seats: number;
  departureAt: Date;
}

interface TripConfirmedParams {
  eventTitle: string;
  departureAt: Date;
}

interface DepartureReminderParams {
  departureAt: Date;
  boardingPointName?: string;
}

// templateKey -> message builder. Add a new key here to support a new trip notification.
const TEMPLATES = {
  reservationConfirmed: (p: ReservationConfirmedParams): TripMessage => ({
    title: "예약이 확정됐어요",
    body: `${p.passengerName}님, 셔틀 예약(${p.seats}석)이 확정됐습니다. 출발: ${formatKoDateTime(p.departureAt)}`,
  }),
  tripConfirmed: (p: TripConfirmedParams): TripMessage => ({
    title: "셔틀 확정 안내",
    body: `[${p.eventTitle}] 셔틀 운행이 확정됐습니다. 출발: ${formatKoDateTime(p.departureAt)}`,
  }),
  departureReminder: (p: DepartureReminderParams): TripMessage => ({
    title: "출발 안내",
    body: `곧 출발합니다${p.boardingPointName ? ` (${p.boardingPointName})` : ""}. 탑승 준비해 주세요.`,
  }),
} as const;

export type TripTemplateKey = keyof typeof TEMPLATES;
type TemplateParamsOf<K extends TripTemplateKey> = Parameters<(typeof TEMPLATES)[K]>[0];

export function buildTripMessage<K extends TripTemplateKey>(
  templateKey: K,
  params: TemplateParamsOf<K>
): TripMessage {
  const build = TEMPLATES[templateKey] as (p: TemplateParamsOf<K>) => TripMessage;
  return build(params);
}

interface NotifyChannel {
  name: string;
  canSend(participant: TripParticipant): boolean;
  send(participant: TripParticipant, message: TripMessage): Promise<void>;
}

// No real AlimTalk/email provider is wired up yet (no API key, no SDK) — these
// mock channels log what would have been sent. Swap the implementations for
// real provider calls once credentials exist; notifyTrip's contract doesn't change.
const alimtalkChannel: NotifyChannel = {
  name: "alimtalk",
  canSend: (participant) => !!participant.passengerPhone,
  async send(participant, message) {
    console.log(`[MockAlimTalk -> ${participant.passengerPhone}] ${message.title}: ${message.body}`);
  },
};

const emailChannel: NotifyChannel = {
  name: "email",
  canSend: (participant) => !!participant.passengerEmail,
  async send(participant, message) {
    console.log(`[MockEmail -> ${participant.passengerEmail}] ${message.title}: ${message.body}`);
  },
};

const CHANNELS: NotifyChannel[] = [alimtalkChannel, emailChannel];

export interface NotifyTripResult {
  sentCount: number;
  failedCount: number;
}

export async function notifyTrip<K extends TripTemplateKey>(
  tripId: number,
  templateKey: K,
  params: TemplateParamsOf<K>,
  audience: ParticipantFilter = "all"
): Promise<NotifyTripResult> {
  const message = buildTripMessage(templateKey, params);
  const participants = await getTripParticipants(tripId, audience);

  let sentCount = 0;
  let failedCount = 0;
  for (const participant of participants) {
    for (const channel of CHANNELS.filter((c) => c.canSend(participant))) {
      try {
        await channel.send(participant, message);
        sentCount++;
      } catch (error) {
        failedCount++;
        console.warn(`[notifyTrip] ${channel.name} send failed for user ${participant.userId}:`, error);
      }
    }
  }

  return { sentCount, failedCount };
}

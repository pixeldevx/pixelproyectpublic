import { getTaskDateValue } from "@/lib/taskProgress";

type MeetingRecurrenceFrequency = "none" | "daily" | "weekly" | "monthly";

const RECURRENCE_LABELS: Record<MeetingRecurrenceFrequency, string> = {
  none: "Unica",
  daily: "Diaria",
  weekly: "Semanal",
  monthly: "Mensual",
};

const RECURRENCE_FREQ: Record<Exclude<MeetingRecurrenceFrequency, "none">, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
};

const pad = (value: number) => String(value).padStart(2, "0");

const escapeIcsText = (value: unknown) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const sanitizeFilename = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "reunion";

const toUtcCalendarValue = (date: Date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

const combineDateAndTime = (dateValue: any, timeValue: string) => {
  const date = getTaskDateValue(dateValue);
  if (!date || !timeValue) return null;

  const [hours = "0", minutes = "0"] = String(timeValue).split(":");
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    Number(hours),
    Number(minutes),
    0,
    0,
  );
};

export const isMeetingTask = (task: any) => task?.type === "meeting" || Boolean(task?.meeting);

export const getMeetingLocation = (task: any) =>
  String(task?.meeting?.location || task?.meetingLocation || "").trim();

export const getMeetingAgenda = (task: any) =>
  String(task?.meeting?.agenda || task?.meetingAgenda || "").trim();

export const getMeetingDescription = (task: any) =>
  String(task?.meeting?.description || task?.description || task?.initialObservation || task?.meetingDescription || "").trim();

export const isMeetingLocationUrl = (task: any) => /^https?:\/\//i.test(getMeetingLocation(task));

export const getMeetingStartDate = (task: any) =>
  getTaskDateValue(task?.meeting?.startAt || task?.meetingStartAt) ||
  combineDateAndTime(task?.startDate || task?.start, task?.meeting?.startTime || task?.meetingStartTime || "09:00") ||
  getTaskDateValue(task?.startDate || task?.start);

export const getMeetingEndDate = (task: any) => {
  const startDate = getMeetingStartDate(task);
  const explicitEnd =
    getTaskDateValue(task?.meeting?.endAt || task?.meetingEndAt) ||
    combineDateAndTime(task?.startDate || task?.start, task?.meeting?.endTime || task?.meetingEndTime || "10:00");

  if (explicitEnd && (!startDate || explicitEnd.getTime() > startDate.getTime())) return explicitEnd;
  if (!startDate) return explicitEnd;

  return new Date(startDate.getTime() + 60 * 60 * 1000);
};

export const getMeetingRecurrenceFrequency = (task: any): MeetingRecurrenceFrequency =>
  (task?.meeting?.recurrence?.frequency || task?.meetingRecurrence || "none") as MeetingRecurrenceFrequency;

export const getMeetingRecurrenceRule = (task: any) => {
  const frequency = getMeetingRecurrenceFrequency(task);
  if (frequency === "none") return "";

  const recurrence = task?.meeting?.recurrence || {};
  const interval = Math.max(1, Number(recurrence.interval || task?.meetingRecurrenceInterval || 1));
  const untilDate =
    getTaskDateValue(recurrence.until || task?.meetingRecurrenceUntil) ||
    getTaskDateValue(task?.endDate || task?.end);
  const count = Number(recurrence.count || task?.meetingRecurrenceCount || 0);
  const ruleParts = [`FREQ=${RECURRENCE_FREQ[frequency]}`, `INTERVAL=${interval}`];

  if (count > 0) {
    ruleParts.push(`COUNT=${Math.floor(count)}`);
  } else if (untilDate) {
    const untilEnd = new Date(untilDate);
    untilEnd.setHours(23, 59, 59, 999);
    ruleParts.push(`UNTIL=${toUtcCalendarValue(untilEnd)}`);
  }

  return ruleParts.join(";");
};

export const getMeetingRecurrenceLabel = (task: any) => {
  const frequency = getMeetingRecurrenceFrequency(task);
  if (frequency === "none") return "Unica";

  const recurrence = task?.meeting?.recurrence || {};
  const interval = Math.max(1, Number(recurrence.interval || task?.meetingRecurrenceInterval || 1));
  const untilDate =
    getTaskDateValue(recurrence.until || task?.meetingRecurrenceUntil) ||
    getTaskDateValue(task?.endDate || task?.end);
  const suffix = untilDate
    ? ` hasta ${new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(untilDate)}`
    : "";

  if (interval === 1) return `${RECURRENCE_LABELS[frequency]}${suffix}`;
  return `Cada ${interval} ${frequency === "daily" ? "dias" : frequency === "weekly" ? "semanas" : "meses"}${suffix}`;
};

export const getMeetingScheduleLabel = (task: any) => {
  const startDate = getMeetingStartDate(task);
  const endDate = getMeetingEndDate(task);
  if (!startDate || !endDate) return "Horario por definir";

  const dateLabel = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" }).format(startDate);
  const timeFormatter = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });
  return `${dateLabel} · ${timeFormatter.format(startDate)} - ${timeFormatter.format(endDate)}`;
};

export const createMeetingIcs = (task: any) => {
  const startDate = getMeetingStartDate(task);
  const endDate = getMeetingEndDate(task);
  if (!startDate || !endDate) return "";

  const title = task?.title || task?.name || "Reunion";
  const descriptionParts = [
    task?.description,
    task?.meeting?.agenda,
    task?.meeting?.notes,
    task?.projectName ? `Proyecto: ${task.projectName}` : "",
  ].filter(Boolean);
  const attendees = Array.isArray(task?.meeting?.attendees) ? task.meeting.attendees : [];
  const attendeeLines = attendees
    .filter((attendee: any) => attendee?.email)
    .map((attendee: any) => `ATTENDEE;CN=${escapeIcsText(attendee.name || attendee.email)}:MAILTO:${attendee.email}`);
  const recurrenceRule = getMeetingRecurrenceRule(task);

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pixel Project//Meeting Task//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${task?.id || Date.now()}@pixel-project`,
    `DTSTAMP:${toUtcCalendarValue(new Date())}`,
    `DTSTART:${toUtcCalendarValue(startDate)}`,
    `DTEND:${toUtcCalendarValue(endDate)}`,
    recurrenceRule ? `RRULE:${recurrenceRule}` : "",
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.join("\n\n"))}`,
    task?.meeting?.location ? `LOCATION:${escapeIcsText(task.meeting.location)}` : "",
    ...attendeeLines,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
};

export const downloadMeetingIcs = (task: any) => {
  const ics = createMeetingIcs(task);
  if (!ics) return false;

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(task?.title || task?.name || "reunion")}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
};

export const createGoogleCalendarUrl = (task: any) => {
  const startDate = getMeetingStartDate(task);
  const endDate = getMeetingEndDate(task);
  if (!startDate || !endDate) return "";

  const title = task?.title || task?.name || "Reunion";
  const details = [task?.description, task?.meeting?.agenda, task?.meeting?.notes]
    .filter(Boolean)
    .join("\n\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toUtcCalendarValue(startDate)}/${toUtcCalendarValue(endDate)}`,
    details,
    location: task?.meeting?.location || "",
  });
  const recurrenceRule = getMeetingRecurrenceRule(task);
  if (recurrenceRule) params.set("recur", `RRULE:${recurrenceRule}`);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

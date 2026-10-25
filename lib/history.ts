import type { Slot } from "@/lib/slots/reconcile";
import { normalizeChatName } from "@/lib/slots/reconcile";

export type FinalStatus =
    | "resolvido"
    | "fila"
    | "abandono"
    | "transfer_n2"
    | "falta_interacao";

export interface HistoryLog {
    id: string;
    protocolo: string;
    nome: string;
    matricula: string;
    tipoCliente: string;
    motivoAtual: string;
    tags: string[];
    motivo: string;
    horario: string;
    duracao: string;
    durationMs: number;
    startTs: number | null;
    endTs: number | null;
    tmaEligible: boolean;
    status: FinalStatus;
}

export type HistoryMap = Record<
    string,
    { count: number; logs: HistoryLog[] }
>;

export function parseHistory(raw: unknown): HistoryMap {
    if (!raw || typeof raw !== "object") return {};
    const result: HistoryMap = {};
    for (const [day, value] of Object.entries(
        raw as Record<string, unknown>,
    )) {
        if (!value || typeof value !== "object") continue;
        const data = value as { count?: unknown; logs?: unknown };
        const logs = Array.isArray(data.logs)
            ? (data.logs.filter(Boolean) as HistoryLog[])
            : [];
        const count =
            typeof data.count === "number" && Number.isFinite(data.count)
                ? data.count
                : logs.length;
        result[day] = { count, logs };
    }
    return result;
}

export function totalAttendance(history: HistoryMap) {
    return Object.values(history).reduce((sum, day) => sum + day.count, 0);
}

export function logIsTmaEligible(log: HistoryLog) {
    return (
        log.tmaEligible === true ||
        (log.tmaEligible === undefined && log.status === "resolvido")
    );
}

export function logDurationMs(log: HistoryLog) {
    if (typeof log.durationMs === "number" && log.durationMs > 0) {
        return log.durationMs;
    }
    if (log.startTs && log.endTs) return log.endTs - log.startTs;
    return 0;
}

export function tmaForLogs(logs: HistoryLog[]) {
    let total = 0;
    let count = 0;
    for (const log of logs) {
        if (!logIsTmaEligible(log)) continue;
        const duration = logDurationMs(log);
        if (duration > 0) {
            total += duration;
            count += 1;
        }
    }
    if (!count) return { totalMs: 0, averageMs: 0, count: 0 };
    return { totalMs: total, averageMs: total / count, count };
}

export function attendanceStats(
    history: HistoryMap,
    name: string,
    today: string,
) {
    const target = normalizeChatName(name);
    if (!target) return { total: 0, today: 0 };

    let total = 0;
    let todayCount = 0;
    for (const [day, data] of Object.entries(history)) {
        for (const log of data.logs) {
            if (normalizeChatName(log?.nome ?? "") !== target) continue;
            total += 1;
            if (day === today) todayCount += 1;
        }
    }
    return { total, today: todayCount };
}

export function historyStatus(status: FinalStatus) {
    switch (status) {
        case "falta_interacao":
            return {
                label: "FALTA INTERAÇÃO",
                className: "history-yellow",
            };
        case "transfer_n2":
            return {
                label: "TRANSFERÊNCIA N2",
                className: "history-yellow",
            };
        case "abandono":
            return { label: "ABANDONO", className: "history-orange" };
        default:
            return { label: "RESOLVIDO", className: "history-green" };
    }
}

export function makeHistoryLog(
    slot: Slot,
    status: FinalStatus,
    options: {
        motivo?: string;
        includeTma: boolean;
        endTs: number;
        horario: string;
    },
): HistoryLog {
    const endTs = options.endTs;
    const startTs = slot.openedAt || endTs;
    const duration = endTs - startTs;
    const includeTma = options.includeTma;
    return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        protocolo: slot.protocolo || "SEM PROTOCOLO",
        nome: slot.nome || "ANÔNIMO",
        matricula: slot.matricula || "N/A",
        tipoCliente: slot.tipoCliente || "N/A",
        motivoAtual: slot.motivoAtual || "N/A",
        tags: Array.isArray(slot.tags) ? slot.tags : [],
        motivo:
            options.motivo !== undefined
                ? options.motivo
                : slot.motivo || "Sem relato",
        horario: options.horario,
        duracao: includeTma
            ? formatHistoryDuration(duration)
            : "-",
        durationMs: includeTma ? duration : 0,
        startTs: includeTma ? startTs : null,
        endTs: includeTma ? endTs : null,
        tmaEligible: includeTma,
        status,
    };
}

export function formatHistoryDuration(ms: number) {
    const totalSecs = Math.max(0, Math.floor((ms || 0) / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function formatTma(ms: number) {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`;
}

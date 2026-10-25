"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useNow } from "@/hooks/useNow";
import { copyText } from "@/lib/clipboard";
import {
    APP_SCALE,
    FONT_SCALE,
    STORAGE_KEYS,
    TOOL_DEFAULTS,
} from "@/lib/config";
import { CACHE_CLEARED_EVENT, FLUXOS_UPDATED_EVENT } from "@/lib/events";
import {
    persistFluxos,
    readFluxosFromCache,
    writeFluxosToCache,
    type Fluxo,
} from "@/lib/fluxos";
import {
    formatTma,
    historyStatus,
    logDurationMs,
    tmaForLogs,
    type HistoryLog,
} from "@/lib/history";
import { getToday } from "@/lib/format";
import { fwAlert, fwConfirm } from "@/lib/modal";
import { applyAppScale, applyFontScale } from "@/lib/scales";
import {
    readAppScale,
    readFontScale,
    readJSON,
    writeJSON,
} from "@/lib/storage";
import { useFirewall } from "@/store/firewall";
import { QueueTool } from "./queue-tool";
import { ToolWindow } from "./tool-window";

type ToolId =
    | "fila"
    | "forponto"
    | "gx"
    | "config"
    | "messages"
    | "notes"
    | "history";

interface WorkspaceMenuDefinition {
    id: ToolId;
    label: string;
    className: string;
}

const WORKSPACE_MENUS: WorkspaceMenuDefinition[] = [
    { id: "forponto", label: "FORPONTO", className: "menu-forponto" },
    { id: "gx", label: "GX", className: "menu-gx" },
    { id: "fila", label: "FILA", className: "menu-fila" },
    { id: "config", label: "⚙ CONFIG", className: "menu-config" },
    { id: "messages", label: "MENSAGENS", className: "menu-messages" },
    { id: "notes", label: "NOTAS", className: "menu-notes" },
    { id: "history", label: "HISTÓRICO", className: "menu-history" },
];

// ───────────────────────────── HISTÓRICO ─────────────────────────────

function HistoryEntry({ log }: { log: HistoryLog }) {
    const { label, className } = historyStatus(log.status);
    const duration = logDurationMs(log);
    const tmaIndividual = duration > 0 ? formatTma(duration) : log.duracao;

    return (
        <article className={`history-entry ${className}`}>
            <div className="history-entry-top">
                <b>{log.protocolo}</b>
                <strong>{label}</strong>
                <span>
                    ⏱ {tmaIndividual || "--"} · {log.horario}
                </span>
            </div>
            <b className="history-operator">OPERADOR: {log.nome}</b>
            {log.matricula ? (
                <small style={{ color: "#22d3ee" }}>ID: {log.matricula}</small>
            ) : null}
            <small style={{ color: "#fcd34d" }}>
                TIPO CLIENTE: {log.tipoCliente || "N/A"}
            </small>
            <small style={{ color: "#fde68a" }}>
                MOTIVO ATUAL: {log.motivoAtual || "N/A"}
            </small>
            <small style={{ color: "#c4b5fd" }}>
                TAGS:{" "}
                {Array.isArray(log.tags) && log.tags.length
                    ? log.tags.join(", ")
                    : "N/A"}
            </small>
            {log.motivo ? <p>MSG: {log.motivo}</p> : null}
        </article>
    );
}

function HistoryTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const history = useFirewall((state) => state.history);
    const total = useFirewall((state) => state.totalAtendimentos);
    const days = useMemo(
        () => Object.entries(history).sort(([a], [b]) => b.localeCompare(a)),
        [history],
    );

    return (
        <ToolWindow
            id="log-window"
            title=">_ ATENDIMENTOS_FINALIZADOS.LOG"
            color="#22d3ee"
            defaults={TOOL_DEFAULTS.history}
            minSize={{ width: 360, height: 320 }}
            headerStyle={{
                background: "rgba(8,145,178,0.12)",
                borderBottom: "1px solid rgba(8,145,178,0.24)",
            }}
            open={open}
            onClose={onClose}
        >
            <div className="history-window-body">
                <div id="total-count-large" className="history-total">
                    {total} <span>SESSÕES</span>
                </div>
                <div id="log-content" className="history-list">
                    {days.length === 0 ? (
                        <div className="tool-empty">
                            Nenhum atendimento registrado
                        </div>
                    ) : (
                        days.map(([day, data]) => {
                            const tma = tmaForLogs(data.logs);
                            const label = new Date(
                                `${day}T00:00:00`,
                            ).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                            });
                            return (
                                <section className="history-day" key={day}>
                                    <header>
                                        <b>{label}</b>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 12,
                                            }}
                                        >
                                            <span>
                                                {data.count} atendimento
                                                {data.count === 1 ? "" : "s"}
                                            </span>
                                            {tma.count > 0 ? (
                                                <span
                                                    style={{
                                                        color: "#34d399",
                                                        fontSize: "10px",
                                                    }}
                                                >
                                                    TMA:{" "}
                                                    {formatTma(
                                                        tma.averageMs,
                                                    )}
                                                </span>
                                            ) : null}
                                        </div>
                                    </header>
                                    {data.logs.map((log) => (
                                        <HistoryEntry
                                            key={log.id ?? `${day}-${log.horario}`}
                                            log={log}
                                        />
                                    ))}
                                </section>
                            );
                        })
                    )}
                </div>
            </div>
        </ToolWindow>
    );
}

// ───────────────────────────── CONFIG ─────────────────────────────

function ConfigTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const muted = useFirewall((state) => state.attentionMuted);
    const setAttentionMuted = useFirewall(
        (state) => state.setAttentionMuted,
    );
    const clearHistoryData = useFirewall((state) => state.clearHistoryData);
    const clearAllCache = useFirewall((state) => state.clearAllCache);

    const [fontPercent, setFontPercent] = useState(
        Math.round(FONT_SCALE.default * 100),
    );
    const [scalePercent, setScalePercent] = useState(
        Math.round(APP_SCALE.default * 100),
    );
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) {
            setFontPercent(Math.round(readFontScale() * 100));
            setScalePercent(Math.round(readAppScale() * 100));
        }
        wasOpen.current = open;
    }, [open]);

    function changeFont(rawValue: number) {
        setFontPercent(rawValue);
        applyFontScale(rawValue / 100);
    }

    function changeScale(rawValue: number) {
        setScalePercent(rawValue);
        applyAppScale(rawValue / 100);
    }

    async function clearHistory() {
        const ok = await fwConfirm(
            "Tem certeza que deseja limpar todo o histórico?",
        );
        if (!ok) return;
        clearHistoryData();
    }

    async function clearAll() {
        const ok = await fwConfirm(
            "⚠️ ATENÇÃO: Isso vai limpar TODOS os dados salvos (histórico, pontos, slots, contador). Deseja continuar?",
        );
        if (!ok) return;
        clearAllCache();
        await fwAlert("Cache limpo com sucesso!");
    }

    function resetScales() {
        applyFontScale(FONT_SCALE.default);
        applyAppScale(APP_SCALE.default);
        setFontPercent(Math.round(FONT_SCALE.default * 100));
        setScalePercent(Math.round(APP_SCALE.default * 100));
    }

    return (
        <ToolWindow
            id="settings-panel"
            title=">_ CONFIGURAÇÕES.EXE"
            color="#cbd5e1"
            defaults={TOOL_DEFAULTS.config}
            minSize={{ width: 380, height: 360 }}
            headerStyle={{
                background: "rgba(100,116,139,0.12)",
                borderBottom: "1px solid rgba(100,116,139,0.25)",
            }}
            open={open}
            onClose={onClose}
        >
            <div className="settings-body">
                <div className="settings-group">
                    <div className="settings-row">
                        <label
                            htmlFor="font-size-slider"
                            className="settings-label"
                        >
                            Tamanho da fonte (site todo)
                        </label>
                        <span
                            id="font-size-value"
                            className="settings-value"
                        >
                            {fontPercent}%
                        </span>
                    </div>
                    <input
                        id="font-size-slider"
                        type="range"
                        min={85}
                        max={220}
                        step={5}
                        value={fontPercent}
                        onChange={(event) =>
                            changeFont(Number(event.target.value))
                        }
                        className="settings-slider"
                    />
                    <div className="settings-hint">
                        Ajusta textos gerais da interface. Preferência salva
                        automaticamente.
                    </div>
                </div>

                <div className="settings-group">
                    <div className="settings-row">
                        <label
                            htmlFor="interface-zoom-slider"
                            className="settings-label"
                        >
                            Zoom da interface inteira
                        </label>
                        <span
                            id="interface-zoom-value"
                            className="settings-value"
                        >
                            {scalePercent}%
                        </span>
                    </div>
                    <input
                        id="interface-zoom-slider"
                        type="range"
                        min={70}
                        max={150}
                        step={2}
                        value={scalePercent}
                        onChange={(event) =>
                            changeScale(Number(event.target.value))
                        }
                        className="settings-slider"
                    />
                    <div className="settings-hint">
                        Aumenta ou diminui toda a interface (janelas, botões
                        e layout geral).
                    </div>
                </div>

                <div className="settings-group">
                    <div className="settings-row">
                        <label
                            htmlFor="attention-sound-mute-toggle"
                            className="settings-label"
                        >
                            Mutar alerta de conversa inativa (+1 min)
                        </label>
                        <label className="settings-switch">
                            <input
                                id="attention-sound-mute-toggle"
                                type="checkbox"
                                checked={muted}
                                onChange={(event) =>
                                    setAttentionMuted(event.target.checked)
                                }
                            />
                            <span className="settings-switch-slider" />
                        </label>
                    </div>
                    <div className="settings-hint">
                        Quando ativado, silencia o som repetido de aviso
                        quando um chat fica aguardando resposta por mais de 1
                        minuto.
                    </div>
                </div>

                <div className="settings-group">
                    <div className="settings-label">Manutenção</div>
                    <div
                        className="settings-actions"
                        style={{
                            justifyContent: "flex-start",
                            gap: 8,
                            flexWrap: "wrap",
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => void clearHistory()}
                            className="settings-btn settings-btn-danger"
                        >
                            🗑️ Limpar histórico
                        </button>
                        <button
                            type="button"
                            onClick={() => void clearAll()}
                            className="settings-btn settings-btn-warning"
                        >
                            ⚠️ Limpar todo cache
                        </button>
                    </div>
                </div>

                <div className="settings-actions">
                    <button
                        type="button"
                        onClick={resetScales}
                        className="settings-btn settings-btn-secondary"
                    >
                        Padrão
                    </button>
                    <button
                        type="button"
                        onClick={onClose}
                        className="settings-btn settings-btn-primary"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </ToolWindow>
    );
}

// ───────────────────────────── NOTAS ─────────────────────────────

interface NotepadCache {
    content: string;
    updatedAt: number | null;
}

interface TerminalLine {
    text: string;
    color: string;
}

function readNotepadCache(): NotepadCache {
    const parsed = readJSON<{
        content?: unknown;
        updatedAt?: unknown;
    } | null>(STORAGE_KEYS.notepad, null);
    return {
        content:
            parsed && typeof parsed.content === "string"
                ? parsed.content
                : "",
        updatedAt:
            parsed && typeof parsed.updatedAt === "number"
                ? parsed.updatedAt
                : null,
    };
}

function saveNotepadCache(content: string) {
    const payload = { content: content || "", updatedAt: Date.now() };
    writeJSON(STORAGE_KEYS.notepad, payload);
    return payload;
}

function NotesTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [mode, setMode] = useState<"text" | "terminal">("text");
    const [text, setText] = useState("");
    const [lines, setLines] = useState<TerminalLine[]>([]);
    const [command, setCommand] = useState("");
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const outputRef = useRef<HTMLDivElement>(null);
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        setText(readNotepadCache().content);
        setLines([
            {
                text: 'notes terminal pronto. use "help" para listar comandos.',
                color: "#22c55e",
            },
        ]);
        return () => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
        };
    }, []);

    useEffect(() => {
        const onCacheCleared = () => setText("");
        window.addEventListener(CACHE_CLEARED_EVENT, onCacheCleared);
        return () =>
            window.removeEventListener(CACHE_CLEARED_EVENT, onCacheCleared);
    }, []);

    useEffect(() => {
        const output = outputRef.current;
        if (output) output.scrollTop = output.scrollHeight;
    }, [lines]);

    function updateText(value: string) {
        setText(value);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
            saveNotepadCache(value);
        }, 250);
    }

    function appendLine(lineText: string, color: string) {
        setLines((current) => [...current, { text: lineText, color }]);
    }

    function runCommand(raw: string) {
        const cmd = raw.trim();
        setCommand("");
        appendLine(`notes@cache:~$ ${cmd}`, "#60a5fa");
        if (!cmd) return;

        if (cmd === "help") {
            appendLine(
                "comandos: help, save, load, show, cache, clear, cls, note <texto>",
                "#94a3b8",
            );
            return;
        }
        if (cmd === "save") {
            const payload = saveNotepadCache(text);
            appendLine(
                `salvo no cache local. ${new Date(
                    payload.updatedAt,
                ).toLocaleString("pt-BR")}`,
                "#22c55e",
            );
            return;
        }
        if (cmd === "load") {
            setText(readNotepadCache().content);
            appendLine("anotacoes carregadas do cache.", "#22c55e");
            return;
        }
        if (cmd === "show") {
            if (!text.trim()) {
                appendLine("(sem conteudo)", "#94a3b8");
                return;
            }
            appendLine(text, "#e2e8f0");
            return;
        }
        if (cmd === "cache") {
            const cached = readNotepadCache();
            const size = new Blob([cached.content]).size;
            const when = cached.updatedAt
                ? new Date(cached.updatedAt).toLocaleString("pt-BR")
                : "nunca";
            appendLine(
                `tamanho: ${size} bytes | ultima gravacao: ${when}`,
                "#94a3b8",
            );
            return;
        }
        if (cmd === "clear") {
            setText("");
            saveNotepadCache("");
            appendLine(
                "anotacoes limpas e cache atualizado.",
                "#f59e0b",
            );
            return;
        }
        if (cmd === "cls") {
            setLines([]);
            return;
        }
        if (cmd.startsWith("note ")) {
            const note = cmd.slice(5).trim();
            if (!note) {
                appendLine("uso: note <texto>", "#ef4444");
                return;
            }
            const next = `${text}${text ? "\n" : ""}${note}`;
            setText(next);
            saveNotepadCache(next);
            appendLine("linha adicionada e salva.", "#22c55e");
            return;
        }

        appendLine(`comando nao reconhecido: ${cmd}`, "#ef4444");
    }

    async function clearCache() {
        const ok = await fwConfirm(
            "Limpar as anotações salvas no cache do navegador?",
        );
        if (!ok) return;
        setText("");
        saveNotepadCache("");
        appendLine("cache limpo com sucesso.", "#f59e0b");
    }

    return (
        <ToolWindow
            id="notepad"
            title=">_ NOTES_CACHE.EXE"
            color="#f59e0b"
            defaults={TOOL_DEFAULTS.notepad}
            minSize={{ width: 320, height: 240 }}
            headerActions={
                <>
                    <button
                        type="button"
                        className="slot-action-btn notepad-mode-text"
                        onClick={() => setMode("text")}
                    >
                        texto
                    </button>
                    <button
                        type="button"
                        className="slot-action-btn notepad-mode-terminal"
                        onClick={() => setMode("terminal")}
                    >
                        terminal
                    </button>
                    <button
                        type="button"
                        className="slot-action-btn notepad-clear"
                        onClick={() => void clearCache()}
                    >
                        limpar cache
                    </button>
                </>
            }
            open={open}
            onClose={onClose}
        >
            <div className="notepad-body">
                <textarea
                    id="notepad-content"
                    value={text}
                    placeholder="Digite suas anotações... (salva automaticamente no cache)"
                    onChange={(event) => updateText(event.target.value)}
                    style={{
                        display: mode === "text" ? "block" : "none",
                    }}
                />
                <div
                    id="notepad-terminal"
                    className="notepad-terminal"
                    style={{
                        display: mode === "terminal" ? "flex" : "none",
                    }}
                >
                    <div
                        id="notepad-terminal-output"
                        className="notepad-terminal-output"
                        ref={outputRef}
                    >
                        {lines.map((line, index) => (
                            <div
                                className="notepad-terminal-line"
                                key={`${index}-${line.text}`}
                                style={{ color: line.color }}
                            >
                                {line.text}
                            </div>
                        ))}
                    </div>
                    <div className="notepad-terminal-input-row">
                        <span>notes@cache:~$</span>
                        <input
                            id="notepad-terminal-input"
                            className="notepad-terminal-input"
                            type="text"
                            autoComplete="off"
                            placeholder="help"
                            value={command}
                            onChange={(event) =>
                                setCommand(event.target.value)
                            }
                            onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                runCommand(command);
                            }}
                        />
                    </div>
                </div>
            </div>
        </ToolWindow>
    );
}

// ───────────────────────────── FORPONTO ─────────────────────────────

interface Ponto {
    tipo: "ENTRADA" | "SAÍDA";
    horario: string;
    timestamp: number;
}

interface PontoData {
    hoje: Ponto[];
    historico: Record<string, Ponto[]>;
}

const EMPTY_PONTO_DATA: PontoData = { hoje: [], historico: {} };

function readPontoData(): PontoData {
    const parsed = readJSON<{
        hoje?: unknown;
        historico?: unknown;
    } | null>(STORAGE_KEYS.forponto, null);

    if (!parsed || typeof parsed !== "object") {
        return { hoje: [], historico: {} };
    }

    const historico =
        parsed.historico &&
        typeof parsed.historico === "object" &&
        !Array.isArray(parsed.historico)
            ? (parsed.historico as Record<string, Ponto[]>)
            : {};

    return {
        hoje: Array.isArray(parsed.hoje) ? (parsed.hoje as Ponto[]) : [],
        historico,
    };
}

function totalWorked(points: Ponto[], nowTs: number) {
    let total = 0;
    const last = points[points.length - 1];
    for (let index = 0; index < points.length; index += 2) {
        if (points[index + 1]) {
            total += points[index + 1].timestamp - points[index].timestamp;
        } else if (last?.tipo === "ENTRADA") {
            total += nowTs - points[index].timestamp;
        }
    }
    return total;
}

function PontoList({
    points,
    empty,
}: {
    points: Ponto[];
    empty: string;
}) {
    if (!points.length) {
        return <div className="tool-empty">{empty}</div>;
    }
    return (
        <div className="ponto-list">
            {points.map((point) => (
                <div key={`${point.timestamp}-${point.tipo}`}>
                    <b
                        className={
                            point.tipo === "ENTRADA"
                                ? "ponto-in"
                                : "ponto-out"
                        }
                    >
                        {point.tipo}
                    </b>
                    <span>{point.horario}</span>
                </div>
            ))}
        </div>
    );
}

function ForpontoTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [data, setData] = useState<PontoData>(EMPTY_PONTO_DATA);
    const [tab, setTab] = useState<"registro" | "historico">("registro");
    const now = useNow(1000);
    const wasOpen = useRef(false);

    useEffect(() => {
        const timer = window.setTimeout(() => setData(readPontoData()), 0);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const onCacheCleared = () => setData(EMPTY_PONTO_DATA);
        window.addEventListener(CACHE_CLEARED_EVENT, onCacheCleared);
        return () =>
            window.removeEventListener(CACHE_CLEARED_EVENT, onCacheCleared);
    }, []);

    // openForPonto(): re-sincroniza o dia atual com o histórico.
    useEffect(() => {
        if (open && !wasOpen.current) {
            const current = readPontoData();
            const today = getToday();
            setData({
                hoje: current.historico[today] ?? [],
                historico: current.historico,
            });
            setTab("registro");
        }
        wasOpen.current = open;
    }, [open]);

    const nowTs = now || data.hoje[data.hoje.length - 1]?.timestamp || 0;
    const clockDate = now ? new Date(now) : null;
    const working = data.hoje[data.hoje.length - 1]?.tipo === "ENTRADA";
    const workedMs = totalWorked(data.hoje, nowTs);

    function baterPonto() {
        const ts = Date.now();
        const tipo: Ponto["tipo"] =
            data.hoje.length % 2 === 0 ? "ENTRADA" : "SAÍDA";
        const ponto: Ponto = {
            tipo,
            horario: new Date(ts).toLocaleTimeString("pt-BR"),
            timestamp: ts,
        };
        const hoje = [...data.hoje, ponto];
        const next: PontoData = {
            hoje,
            historico: {
                ...data.historico,
                [getToday(ts)]: [...hoje],
            },
        };
        setData(next);
        writeJSON(STORAGE_KEYS.forponto, next);
        void fwAlert(
            `Ponto registrado: ${tipo} às ${ponto.horario}`,
        );
    }

    const weekdays = [
        "Domingo",
        "Segunda",
        "Terça",
        "Quarta",
        "Quinta",
        "Sexta",
        "Sábado",
    ];

    return (
        <ToolWindow
            id="forponto-window"
            title=">_ FORPONTO.EXE"
            color="#ef4444"
            defaults={TOOL_DEFAULTS.forponto}
            minSize={{ width: 380, height: 420 }}
            headerStyle={{
                background: "rgba(239,68,68,0.1)",
                borderBottom: "1px solid rgba(239,68,68,0.2)",
            }}
            headerActions={
                <>
                    <button
                        type="button"
                        className="slot-action-btn"
                        id="tab-registro"
                        onClick={() => setTab("registro")}
                        style={{
                            color: tab === "registro" ? "#fff" : "#6b7280",
                        }}
                    >
                        [Registro]
                    </button>
                    <button
                        type="button"
                        className="slot-action-btn"
                        id="tab-historico"
                        onClick={() => setTab("historico")}
                        style={{
                            color:
                                tab === "historico" ? "#fff" : "#6b7280",
                        }}
                    >
                        [Histórico]
                    </button>
                </>
            }
            open={open}
            onClose={onClose}
        >
            {tab === "registro" ? (
                <div id="ponto-registro" className="forponto-pane">
                    <p id="ponto-clock" className="forponto-clock">
                        {clockDate
                            ? clockDate.toLocaleTimeString("pt-BR")
                            : "00:00:00"}
                    </p>
                    <p id="ponto-date" className="forponto-date">
                        {clockDate
                            ? `${weekdays[clockDate.getDay()]}, ${clockDate.toLocaleDateString(
                                  "pt-BR",
                              )}`
                            : ""}
                    </p>
                    <div id="ponto-status" className="forponto-status">
                        <span>Status Atual</span>
                        <b id="ponto-status-text">
                            {working
                                ? "EM EXPEDIENTE"
                                : "FORA DO EXPEDIENTE"}
                        </b>
                        <small id="ponto-tempo-trabalhado">
                            Tempo trabalhado hoje:{" "}
                            {Math.floor(workedMs / 3_600_000)}h{" "}
                            {Math.floor(workedMs / 60_000) % 60}m
                        </small>
                    </div>
                    <button
                        type="button"
                        id="btn-bater-ponto"
                        className="forponto-action"
                        onClick={baterPonto}
                    >
                        BATER PONTO - {working ? "SAÍDA" : "ENTRADA"}
                    </button>
                    <h4>Pontos de Hoje</h4>
                    <div id="ponto-today-list">
                        <PontoList
                            points={data.hoje}
                            empty="Nenhum ponto registrado hoje"
                        />
                    </div>
                </div>
            ) : (
                <div id="ponto-historico" className="forponto-pane">
                    <h4>Histórico de Pontos</h4>
                    <div id="ponto-historico-items">
                        {Object.entries(data.historico).length === 0 ? (
                            <div className="tool-empty">
                                Nenhum histórico disponível
                            </div>
                        ) : (
                            Object.entries(data.historico)
                                .sort(([a], [b]) => b.localeCompare(a))
                                .map(([day, points]) => {
                                    const total = totalWorked(points, nowTs);
                                    return (
                                        <div
                                            className="ponto-day"
                                            key={day}
                                        >
                                            <b>
                                                {new Date(
                                                    `${day}T00:00:00`,
                                                ).toLocaleDateString(
                                                    "pt-BR",
                                                )}
                                            </b>
                                            <span>
                                                {Math.floor(
                                                    total / 3_600_000,
                                                )}
                                                h{" "}
                                                {Math.floor(total / 60_000) %
                                                    60}
                                                m trabalhadas
                                            </span>
                                            <PontoList
                                                points={points}
                                                empty="Nenhum ponto registrado"
                                            />
                                        </div>
                                    );
                                })
                        )}
                    </div>
                </div>
            )}
        </ToolWindow>
    );
}

// ───────────────────────────── GX / FLUXOS ─────────────────────────────

function GXTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [fluxos, setFluxos] = useState<Fluxo[]>([]);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState<Fluxo[]>([]);
    const [newTitulo, setNewTitulo] = useState("");
    const [newCaminho, setNewCaminho] = useState("");
    const [saving, setSaving] = useState(false);
    const [flashIndex, setFlashIndex] = useState<number | null>(null);
    const wasOpen = useRef(false);

    useEffect(() => {
        const refresh = () => setFluxos(readFluxosFromCache());
        const initial = window.setTimeout(refresh, 0);
        window.addEventListener(FLUXOS_UPDATED_EVENT, refresh);
        return () => {
            window.clearTimeout(initial);
            window.removeEventListener(FLUXOS_UPDATED_EVENT, refresh);
        };
    }, []);

    useEffect(() => {
        if (open && !wasOpen.current) {
            setFluxos(readFluxosFromCache());
        }
        if (!open && wasOpen.current) {
            setEditing(false);
        }
        wasOpen.current = open;
    }, [open]);

    function startEditing() {
        setDraft(fluxos.map((fluxo) => ({ ...fluxo })));
        setNewTitulo("");
        setNewCaminho("");
        setEditing(true);
    }

    function updateDraft(
        index: number,
        field: keyof Fluxo,
        value: string,
    ) {
        setDraft((current) =>
            current.map((item, itemIndex) =>
                itemIndex === index ? { ...item, [field]: value } : item,
            ),
        );
    }

    async function copyFluxo(index: number, fluxo: Fluxo) {
        try {
            await copyText(fluxo.caminho);
            setFlashIndex(index);
            window.setTimeout(() => {
                setFlashIndex((current) =>
                    current === index ? null : current,
                );
            }, 250);
        } catch {
            void fwAlert("Não foi possível copiar o fluxo.");
        }
    }

    async function save() {
        if (saving) return;
        const updated: Fluxo[] = [];
        for (const item of draft) {
            const titulo = item.titulo.trim().toUpperCase();
            const caminho = item.caminho.trim().toUpperCase();
            if (titulo && caminho) updated.push({ titulo, caminho });
        }
        const titulo = newTitulo.trim().toUpperCase();
        const caminho = newCaminho.trim().toUpperCase();
        if (titulo && caminho) updated.push({ titulo, caminho });

        setSaving(true);
        writeFluxosToCache(updated);
        const result = await persistFluxos(updated);
        setFluxos(updated);
        setDraft([]);
        setNewTitulo("");
        setNewCaminho("");
        setEditing(false);
        setSaving(false);

        if (result.ok) {
            await fwAlert(
                `✓ ${updated.length} fluxos salvos com sucesso no fluxos.json do servidor!`,
            );
            return;
        }
        await fwAlert(
            "⚠️ Fluxos salvos no navegador, mas o servidor não permitiu gravar em fluxos.json. É necessário habilitar endpoint de escrita no servidor.",
        );
    }

    return (
        <ToolWindow
            id="guia-fluxos"
            title=">_ GUIA_DE_FLUXOS.EXE"
            color="#ef4444"
            defaults={TOOL_DEFAULTS.fluxos}
            minSize={{ width: 380, height: 320 }}
            headerStyle={{
                background: "rgba(239,68,68,0.1)",
                borderBottom: "1px solid rgba(239,68,68,0.2)",
            }}
            headerActions={
                editing ? null : (
                    <button
                        type="button"
                        onClick={startEditing}
                        style={{
                            background: "none",
                            border: "none",
                            color: "#64748b",
                            fontSize: "0.7rem",
                            cursor: "pointer",
                            fontFamily: "'Fira Code', monospace",
                            padding: 0,
                        }}
                    >
                        editar
                    </button>
                )
            }
            open={open}
            onClose={onClose}
        >
            {editing ? (
                <div className="editable-body fluxos-editor">
                    <div className="editable-list">
                        {draft.map((item, index) => (
                            <div
                                className="editable-row"
                                key={`draft-${index}`}
                            >
                                <label>TÍTULO:</label>
                                <input
                                    value={item.titulo}
                                    onChange={(event) =>
                                        updateDraft(
                                            index,
                                            "titulo",
                                            event.target.value,
                                        )
                                    }
                                />
                                <label>CAMINHO:</label>
                                <input
                                    value={item.caminho}
                                    onChange={(event) =>
                                        updateDraft(
                                            index,
                                            "caminho",
                                            event.target.value,
                                        )
                                    }
                                />
                                <button
                                    type="button"
                                    className="remove-btn"
                                    onClick={() =>
                                        setDraft((current) =>
                                            current.filter(
                                                (_, itemIndex) =>
                                                    itemIndex !== index,
                                            ),
                                        )
                                    }
                                >
                                    REMOVER
                                </button>
                            </div>
                        ))}
                        <div className="new-edit-row">
                            <label>NOVO FLUXO — TÍTULO:</label>
                            <input
                                value={newTitulo}
                                placeholder="Ex: NOVO FLUXO"
                                onChange={(event) =>
                                    setNewTitulo(event.target.value)
                                }
                            />
                            <label>CAMINHO:</label>
                            <input
                                value={newCaminho}
                                placeholder="Ex: HELP TECH/..."
                                onChange={(event) =>
                                    setNewCaminho(event.target.value)
                                }
                            />
                        </div>
                    </div>
                    <div className="editor-footer">
                        <button
                            type="button"
                            className="settings-btn settings-btn-secondary"
                            onClick={() => setEditing(false)}
                        >
                            FECHAR
                        </button>
                        <button
                            type="button"
                            className="settings-btn settings-btn-danger"
                            onClick={() => void save()}
                            disabled={saving}
                        >
                            {saving ? "SALVANDO..." : "SALVAR"}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="fluxo-display-list">
                    {fluxos.length === 0 ? (
                        <div
                            style={{
                                color: "#64748b",
                                fontSize: "0.75rem",
                                textAlign: "center",
                                padding: "40px 20px",
                            }}
                        >
                            Nenhum fluxo carregado
                        </div>
                    ) : (
                        fluxos.map((fluxo, index) => (
                            <div
                                className="fluxo-item"
                                key={`${index}-${fluxo.titulo}-${fluxo.caminho}`}
                                style={{
                                    background:
                                        flashIndex === index
                                            ? "rgba(239,68,68,0.2)"
                                            : undefined,
                                }}
                                onClick={() =>
                                    void copyFluxo(index, fluxo)
                                }
                            >
                                <div className="fluxo-title">
                                    {fluxo.titulo}
                                </div>
                                <div className="fluxo-path">
                                    {fluxo.caminho}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </ToolWindow>
    );
}

// ───────────────────── MENSAGENS PENDENTES ─────────────────────

function PendingMessagesTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const pendingMessages = useFirewall((state) => state.pendingMessages);
    const setPendingMessages = useFirewall(
        (state) => state.setPendingMessages,
    );
    const [draft, setDraft] = useState<string[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const wasOpen = useRef(false);

    useEffect(() => {
        if (open && !wasOpen.current) {
            setDraft([...pendingMessages]);
            setNewMessage("");
        }
        wasOpen.current = open;
    }, [open, pendingMessages]);

    function save() {
        const updated = draft
            .map((message) => message.trim())
            .filter(Boolean);
        const extra = newMessage.trim();
        if (extra) updated.push(extra);
        setPendingMessages(updated);
        onClose();
        void fwAlert("✓ Mensagens pendentes salvas com sucesso!");
    }

    return (
        <ToolWindow
            id="pending-messages-editor"
            title="EDITOR DE MENSAGENS PENDENTES"
            color="#22c55e"
            defaults={TOOL_DEFAULTS.messages}
            minSize={{ width: 400, height: 340 }}
            headerStyle={{
                background: "rgba(34,197,94,0.1)",
                borderBottom: "1px solid rgba(34,197,94,0.2)",
            }}
            open={open}
            onClose={onClose}
        >
            <div className="editable-body messages-editor">
                <div className="editable-list">
                    {draft.map((message, index) => (
                        <div className="editable-row" key={`msg-${index}`}>
                            <label>MENSAGEM {index + 1}:</label>
                            <input
                                type="text"
                                value={message}
                                onChange={(event) =>
                                    setDraft((current) =>
                                        current.map((item, itemIndex) =>
                                            itemIndex === index
                                                ? event.target.value
                                                : item,
                                        ),
                                    )
                                }
                            />
                            <button
                                type="button"
                                className="remove-btn"
                                onClick={() =>
                                    setDraft((current) =>
                                        current.filter(
                                            (_, itemIndex) =>
                                                itemIndex !== index,
                                        ),
                                    )
                                }
                            >
                                REMOVER
                            </button>
                        </div>
                    ))}
                    <div className="new-edit-row">
                        <label>NOVA MENSAGEM:</label>
                        <input
                            type="text"
                            placeholder="Digite a nova mensagem padrão..."
                            value={newMessage}
                            onChange={(event) =>
                                setNewMessage(event.target.value)
                            }
                        />
                    </div>
                </div>
                <div className="editor-footer">
                    <button
                        type="button"
                        className="settings-btn settings-btn-secondary"
                        onClick={onClose}
                    >
                        FECHAR
                    </button>
                    <button
                        type="button"
                        className="settings-btn settings-btn-primary"
                        onClick={save}
                    >
                        SALVAR
                    </button>
                </div>
            </div>
        </ToolWindow>
    );
}

// ───────────────────────────── TOOLBAR ─────────────────────────────

const INITIAL_OPEN: Record<ToolId, boolean> = {
    fila: false,
    forponto: false,
    gx: false,
    config: false,
    messages: false,
    notes: false,
    history: false,
};

/**
 * Barra superior e todas as janelas de ferramentas. As janelas continuam
 * montadas quando fechadas para preservar estado e layout, como no original.
 */
export function WorkspaceTools() {
    const [open, setOpen] = useState<Record<ToolId, boolean>>(INITIAL_OPEN);

    const toggle = (id: ToolId) =>
        setOpen((current) => ({ ...current, [id]: !current[id] }));
    const close = (id: ToolId) =>
        setOpen((current) => ({ ...current, [id]: false }));

    return (
        <>
            <div className="workspace-toolbar">
                {WORKSPACE_MENUS.map((menu) => (
                    <button
                        type="button"
                        key={menu.id}
                        className={menu.className}
                        onClick={() => toggle(menu.id)}
                    >
                        {menu.label}
                    </button>
                ))}
            </div>

            <ForpontoTool
                open={open.forponto}
                onClose={() => close("forponto")}
            />
            <GXTool open={open.gx} onClose={() => close("gx")} />
            <QueueTool open={open.fila} onClose={() => close("fila")} />
            <ConfigTool
                open={open.config}
                onClose={() => close("config")}
            />
            <PendingMessagesTool
                open={open.messages}
                onClose={() => close("messages")}
            />
            <NotesTool open={open.notes} onClose={() => close("notes")} />
            <HistoryTool
                open={open.history}
                onClose={() => close("history")}
            />
        </>
    );
}

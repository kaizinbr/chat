"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWindowLayout } from "@/hooks/useWindowLayout";
import { useFirewall, type HistoryLog } from "@/store/firewall";

type Fluxo = { titulo: string; caminho: string };
type ToolId = "forponto" | "gx" | "config" | "messages" | "notes" | "history";

export interface WorkspaceMenuDefinition {
    id: ToolId;
    label: string;
    className: string;
}

export const WORKSPACE_MENUS: WorkspaceMenuDefinition[] = [
    { id: "forponto", label: "FORPONTO", className: "menu-forponto" },
    { id: "gx", label: "GX", className: "menu-gx" },
    { id: "config", label: "⚙ CONFIG", className: "menu-config" },
    { id: "messages", label: "MENSAGENS", className: "menu-messages" },
    { id: "notes", label: "NOTAS", className: "menu-notes" },
    { id: "history", label: "HISTÓRICO", className: "menu-history" },
];

const DEFAULT_MESSAGES = [
    "Só mais um momento.",
    "Estou validando algumas correções, só um momento.",
    "Ok, um momento, por favor.",
];

const todayKey = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function ToolWindow({
    id,
    title,
    children,
    position,
    size,
    minSize = { width: 300, height: 280 },
    color = "#60a5fa",
    headerActions,
    onClose,
}: {
    id: string;
    title: string;
    children: React.ReactNode;
    position: { top: number; left: number };
    size: { width: number; height: number };
    minSize?: { width: number; height: number };
    color?: string;
    headerActions?: React.ReactNode;
    onClose: () => void;
}) {
    const { layout, windowRef, onHeaderMouseDown, bringToFront, zIndex } = useWindowLayout({
        storageKey: "fw_notepad_layouts_v1",
        layoutId: id,
        defaultPosition: position,
        defaultSize: size,
        minSize,
    });
    return (
        <div
            ref={windowRef}
            id={id}
            className={`notepad-window tool-window ${id}`}
            style={{
                top: layout.top,
                left: layout.left,
                width: layout.width,
                height: layout.height,
                borderTopColor: color,
                // boxShadow: `0 0 8px rgba(239, 68, 68, 0.5)`,
                display: "flex",
                zIndex,
            }}
            onMouseDown={bringToFront}
        >
            <div className={`notepad-header-default ${id}-header`} onMouseDown={onHeaderMouseDown}>
                <span style={{ color }}>{title}</span>
                {headerActions}
                <button className="tool-close" onClick={onClose}>
                    ✕
                </button>
            </div>
            <div className="tool-window-body">{children}</div>
        </div>
    );
}

function HistoryWindow({ onClose }: { onClose: () => void }) {
    const history = useFirewall((state) => state.history);
    const days = Object.entries(history).sort(([a], [b]) => b.localeCompare(a));
    const total = days.reduce((sum, [, day]) => sum + day.logs.length, 0);
    function status(log: HistoryLog) {
        if (log.status === "falta_interacao")
            return ["FALTA INTERAÇÃO", "history-yellow"];
        if (log.status === "transfer_n2")
            return ["TRANSFERÊNCIA N2", "history-yellow"];
        if (log.status === "abandono") return ["ABANDONO", "history-orange"];
        return ["RESOLVIDO", "history-green"];
    }
    return (
        <ToolWindow
            id="log-window"
            title=">_ ATENDIMENTOS_FINALIZADOS.LOG"
            position={{ top: 70, left: 190 }}
            size={{ width: 720, height: 620 }}
            color="#0891b2"
            onClose={onClose}
        >
            <div className="history-window-body">
                <div className="history-total">
                    {total} <span>SESSÕES</span>
                </div>
                <div className="history-list">
                    {days.map(([day, data]) => (
                        <section className="history-day" key={day}>
                            <header>
                                <b>
                                    {new Date(
                                        `${day}T00:00:00`,
                                    ).toLocaleDateString("pt-BR", {
                                        day: "2-digit",
                                        month: "short",
                                        year: "numeric",
                                    })}
                                </b>
                                <span>
                                    {data.count} atendimento
                                    {data.count === 1 ? "" : "s"}
                                </span>
                            </header>
                            {data.logs.map((log) => {
                                const [label, className] = status(log);
                                return (
                                    <article
                                        className={`history-entry ${className}`}
                                        key={log.id}
                                    >
                                        <div className="history-entry-top">
                                            <b>{log.protocolo}</b>
                                            <strong>{label}</strong>
                                            <span>
                                                ⏱ {log.duracao} · {log.horario}
                                            </span>
                                        </div>
                                        <b className="history-operator">
                                            OPERADOR: {log.nome}
                                        </b>
                                        <small>
                                            ID: {log.matricula || "N/A"} · TIPO
                                            CLIENTE: {log.tipoCliente || "N/A"}
                                        </small>
                                        <small>
                                            MOTIVO ATUAL:{" "}
                                            {log.motivoAtual || "N/A"}
                                        </small>
                                        <small>
                                            TAGS:{" "}
                                            {log.tags?.length
                                                ? log.tags.join(", ")
                                                : "N/A"}
                                        </small>
                                        {log.motivo && <p>MSG: {log.motivo}</p>}
                                    </article>
                                );
                            })}
                        </section>
                    ))}
                    {!days.length && (
                        <div className="tool-empty">
                            Nenhum atendimento registrado
                        </div>
                    )}
                </div>
            </div>
        </ToolWindow>
    );
}

function ConfigWindow({ onClose }: { onClose: () => void }) {
    const [font, setFont] = useState(100);
    const [scale, setScale] = useState(82);
    const [muted, setMuted] = useState(false);
    const history = useFirewall((state) => state.history);
    useEffect(() => {
        const timer = setTimeout(() => {
            setFont(Number(localStorage.getItem("fw_font_scale_v1") ?? 100));
            setScale(Number(localStorage.getItem("fw_app_scale_v1") ?? 82));
            setMuted(
                localStorage.getItem("fw_attention_sound_muted_v1") === "1",
            );
        }, 0);
        return () => clearTimeout(timer);
    }, []);
    const applyFont = (value: number) => {
        setFont(value);
        document.documentElement.style.setProperty(
            "--font-scale",
            String(value / 100),
        );
        localStorage.setItem("fw_font_scale_v1", String(value));
    };
    const applyScale = (value: number) => {
        setScale(value);
        document.documentElement.style.setProperty(
            "--app-scale",
            String(value / 100),
        );
        localStorage.setItem("fw_app_scale_v1", String(value));
    };
    const clearHistory = () => {
        localStorage.removeItem("fwall_history");
        window.location.reload();
    };
    return (
        <ToolWindow
            id="settings-panel"
            title=">_ CONFIGURAÇÕES.EXE"
            position={{ top: 96, left: 360 }}
            size={{ width: 520, height: 430 }}
            color="#64748b"
            onClose={onClose}
        >
            <div className="settings-body">
                <div className="settings-group">
                    <div className="settings-row">
                        <label className="settings-label">
                            Tamanho da fonte (site todo)
                        </label>
                        <span className="settings-value">{font}%</span>
                    </div>
                    <input
                        className="settings-slider"
                        type="range"
                        min="85"
                        max="220"
                        step="5"
                        value={font}
                        onChange={(event) =>
                            applyFont(Number(event.target.value))
                        }
                    />
                    <div className="settings-hint">
                        Ajusta textos gerais da interface. Preferência salva
                        automaticamente.
                    </div>
                </div>
                <div className="settings-group">
                    <div className="settings-row">
                        <label className="settings-label">
                            Zoom da interface inteira
                        </label>
                        <span className="settings-value">{scale}%</span>
                    </div>
                    <input
                        className="settings-slider"
                        type="range"
                        min="70"
                        max="150"
                        step="2"
                        value={scale}
                        onChange={(event) =>
                            applyScale(Number(event.target.value))
                        }
                    />
                    <div className="settings-hint">
                        Aumenta ou diminui toda a interface.
                    </div>
                </div>
                <div className="settings-group">
                    <div className="settings-row">
                        <label className="settings-label">
                            Mutar alerta de conversa inativa (+1 min)
                        </label>
                        <label className="settings-switch">
                            <input
                                type="checkbox"
                                checked={muted}
                                onChange={(event) => {
                                    setMuted(event.target.checked);
                                    localStorage.setItem(
                                        "fw_attention_sound_muted_v1",
                                        event.target.checked ? "1" : "0",
                                    );
                                }}
                            />
                            <span className="settings-switch-slider" />
                        </label>
                    </div>
                    <div className="settings-hint">
                        Silencia o som repetido de aviso.
                    </div>
                </div>
                <div className="settings-group">
                    <div className="settings-label">Manutenção</div>
                    <div className="settings-actions">
                        <button
                            className="settings-btn settings-btn-danger"
                            onClick={clearHistory}
                        >
                            🗑️ Limpar histórico ({Object.keys(history).length}{" "}
                            dias)
                        </button>
                        <button
                            className="settings-btn settings-btn-warning"
                            onClick={() => localStorage.clear()}
                        >
                            ⚠️ Limpar todo cache
                        </button>
                    </div>
                </div>
                <div className="settings-actions">
                    <button
                        className="settings-btn settings-btn-secondary"
                        onClick={() => {
                            applyFont(100);
                            applyScale(82);
                        }}
                    >
                        Padrão
                    </button>
                    <button
                        className="settings-btn settings-btn-primary"
                        onClick={onClose}
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </ToolWindow>
    );
}

function NotesWindow({ onClose }: { onClose: () => void }) {
    const [mode, setMode] = useState<"text" | "terminal">("text");
    const [text, setText] = useState("");
    const [command, setCommand] = useState("");
    const [output, setOutput] = useState<string[]>([]);
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                setText(
                    JSON.parse(
                        localStorage.getItem("fw_notepad_cache_v1") ?? "{}",
                    ).content ?? "",
                );
            } catch {
                setText("");
            }
        }, 0);
        return () => clearTimeout(timer);
    }, []);
    const save = (value = text) =>
        localStorage.setItem(
            "fw_notepad_cache_v1",
            JSON.stringify({ content: value, updatedAt: Date.now() }),
        );
    const run = () => {
        const cmd = command.trim();
        setCommand("");
        if (cmd === "help")
            setOutput((items) => [
                ...items,
                "comandos: help, save, load, show, cache, clear, cls, note <texto>",
            ]);
        else if (cmd === "save") {
            save();
            setOutput((items) => [...items, "salvo no cache local."]);
        } else if (cmd === "load") {
            try {
                setText(
                    JSON.parse(
                        localStorage.getItem("fw_notepad_cache_v1") ?? "{}",
                    ).content ?? "",
                );
            } catch {
                setText("");
            }
            setOutput((items) => [...items, "anotacoes carregadas do cache."]);
        } else if (cmd === "show")
            setOutput((items) => [...items, text || "(sem conteudo)"]);
        else if (cmd === "clear") {
            setText("");
            save("");
            setOutput((items) => [
                ...items,
                "anotacoes limpas e cache atualizado.",
            ]);
        } else if (cmd === "cls") setOutput([]);
        else if (cmd.startsWith("note ")) {
            const next = `${text}${text ? "\n" : ""}${cmd.slice(5).trim()}`;
            setText(next);
            save(next);
        } else if (cmd)
            setOutput((items) => [...items, `comando nao reconhecido: ${cmd}`]);
    };
    return (
        <ToolWindow
            id="notepad"
            title=">_ NOTES_CACHE.EXE"
            position={{ top: 150, left: 420 }}
            size={{ width: 460, height: 360 }}
            color="#d97706"
            headerActions={
                <div className="notepad-header-actions">
                    <button
                        className="slot-action-btn notepad-mode-text"
                        onClick={() => setMode("text")}
                    >
                        texto
                    </button>
                    <button
                        className="slot-action-btn notepad-mode-terminal"
                        onClick={() => setMode("terminal")}
                    >
                        terminal
                    </button>
                    <button
                        className="slot-action-btn notepad-clear"
                        onClick={() => {
                            setText("");
                            save("");
                        }}
                    >
                        limpar cache
                    </button>
                </div>
            }
            onClose={onClose}
        >
            <div className="notepad-body">
                {mode === "text" ? (
                    <textarea
                        className="notepad-content"
                        value={text}
                        placeholder="Digite suas anotações... (salva automaticamente no cache)"
                        onChange={(event) => {
                            setText(event.target.value);
                            save(event.target.value);
                        }}
                    />
                ) : (
                    <div className="notepad-terminal">
                        <div className="notepad-terminal-output">
                            {output.map((line, index) => (
                                <div
                                    className="notepad-terminal-line"
                                    key={`${line}-${index}`}
                                >
                                    {line}
                                </div>
                            ))}
                        </div>
                        <div className="notepad-terminal-input-row">
                            <span>notes@cache:~$</span>
                            <input
                                className="notepad-terminal-input"
                                value={command}
                                placeholder="help"
                                onChange={(event) =>
                                    setCommand(event.target.value)
                                }
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") run();
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </ToolWindow>
    );
}

interface Ponto {
    tipo: "ENTRADA" | "SAÍDA";
    horario: string;
    timestamp: number;
}
interface PontoData {
    hoje: Ponto[];
    historico: Record<string, Ponto[]>;
}

function ForpontoWindow({ onClose }: { onClose: () => void }) {
    const [data, setData] = useState<PontoData>({ hoje: [], historico: {} });
    const [tab, setTab] = useState<"registro" | "historico">("registro");
    const [now, setNow] = useState(new Date());
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                setData(
                    JSON.parse(
                        localStorage.getItem("forponto_data") ??
                            '{"hoje":[],"historico":{}}',
                    ),
                );
            } catch {
                setData({ hoje: [], historico: {} });
            }
        }, 0);
        const clock = setInterval(() => setNow(new Date()), 1000);
        return () => {
            clearTimeout(timer);
            clearInterval(clock);
        };
    }, []);
    const totalWorked = (points: Ponto[]) =>
        points.reduce(
            (sum, point, index) =>
                point.tipo === "SAÍDA" && points[index - 1]
                    ? sum + point.timestamp - points[index - 1].timestamp
                    : sum,
            0,
        );
    const working = data.hoje.at(-1)?.tipo === "ENTRADA";
    const mark = () => {
        const point: Ponto = {
            tipo: data.hoje.length % 2 === 0 ? "ENTRADA" : "SAÍDA",
            horario: now.toLocaleTimeString("pt-BR"),
            timestamp: now.getTime(),
        };
        const hoje = [...data.hoje, point];
        const next = {
            hoje,
            historico: { ...data.historico, [todayKey()]: hoje },
        };
        setData(next);
        localStorage.setItem("forponto_data", JSON.stringify(next));
    };
    const duration =
        totalWorked(data.hoje) +
        (working
            ? now.getTime() - (data.hoje.at(-1)?.timestamp ?? now.getTime())
            : 0);
    return (
        <ToolWindow
            id="forponto-window"
            title=">_ FORPONTO.EXE"
            position={{ top: 96, left: 56 }}
            size={{ width: 500, height: 580 }}
            color="#ef4444"
            onClose={onClose}
        >
            <div className="forponto-tabs">
                <button
                    className={tab === "registro" ? "active" : ""}
                    onClick={() => setTab("registro")}
                >
                    [Registro]
                </button>
                <button
                    className={tab === "historico" ? "active" : ""}
                    onClick={() => setTab("historico")}
                >
                    [Histórico]
                </button>
            </div>
            {tab === "registro" ? (
                <div className="forponto-pane">
                    <div className="forponto-clock">
                        {now.toLocaleTimeString("pt-BR")}
                    </div>
                    <div className="forponto-date">
                        {now.toLocaleDateString("pt-BR", {
                            weekday: "long",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                        })}
                    </div>
                    <div className="forponto-status">
                        <span>STATUS ATUAL</span>
                        <b>
                            {working ? "EM EXPEDIENTE" : "FORA DO EXPEDIENTE"}
                        </b>
                        <small>
                            Tempo trabalhado hoje:{" "}
                            {Math.floor(duration / 3600000)}h{" "}
                            {Math.floor(duration / 60000) % 60}m
                        </small>
                    </div>
                    <button className="forponto-action" onClick={mark}>
                        BATER PONTO - {working ? "SAÍDA" : "ENTRADA"}
                    </button>
                    <h4>PONTOS DE HOJE</h4>
                    <PontoList points={data.hoje} />
                </div>
            ) : (
                <div className="forponto-pane">
                    <h4>HISTÓRICO DE PONTOS</h4>
                    {Object.entries(data.historico)
                        .sort(([a], [b]) => b.localeCompare(a))
                        .map(([day, points]) => (
                            <div className="ponto-day" key={day}>
                                <b>
                                    {new Date(
                                        `${day}T00:00:00`,
                                    ).toLocaleDateString("pt-BR")}
                                </b>
                                <span>
                                    {Math.floor(totalWorked(points) / 3600000)}h{" "}
                                    {Math.floor(totalWorked(points) / 60000) %
                                        60}
                                    m trabalhadas
                                </span>
                                <PontoList points={points} />
                            </div>
                        ))}
                </div>
            )}
        </ToolWindow>
    );
}

function PontoList({ points }: { points: Ponto[] }) {
    return (
        <div className="ponto-list">
            {points.length ? (
                points.map((point) => (
                    <div key={`${point.timestamp}`}>
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
                ))
            ) : (
                <div className="tool-empty">Nenhum ponto registrado hoje</div>
            )}
        </div>
    );
}

function GXWindow({
    messages,
    onClose,
}: {
    messages: boolean;
    onClose: () => void;
}) {
    const [items, setItems] = useState<string[]>(
        messages ? DEFAULT_MESSAGES : [],
    );
    const [newItem, setNewItem] = useState("");
    const [editing, setEditing] = useState(messages);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (messages) {
                try {
                    const stored = JSON.parse(
                        localStorage.getItem(
                            "pending_auto_reply_messages_v1",
                        ) ?? "[]",
                    );
                    setItems(
                        Array.isArray(stored) && stored.length
                            ? stored
                            : DEFAULT_MESSAGES,
                    );
                } catch {
                    setItems(DEFAULT_MESSAGES);
                }
            } else
                fetch("/fluxos.json")
                    .then((response) => response.json())
                    .then((value) =>
                        setItems(
                            Array.isArray(value)
                                ? value.map(
                                      (item) =>
                                          `${item.titulo} :: ${item.caminho}`,
                                  )
                                : [],
                        ),
                    )
                    .catch(() => setItems([]));
        }, 0);
        return () => clearTimeout(timer);
    }, [messages]);
    const save = (values: string[]) => {
        const clean = values.map((value) => value.trim()).filter(Boolean);
        setItems(clean);
        if (messages)
            localStorage.setItem(
                "pending_auto_reply_messages_v1",
                JSON.stringify(clean),
            );
        else
            localStorage.setItem(
                "guia_fluxos",
                JSON.stringify(
                    clean.map((value) => {
                        const [titulo, ...path] = value.split("::");
                        return {
                            titulo: titulo.trim().toUpperCase(),
                            caminho: path.join("::").trim().toUpperCase(),
                        };
                    }),
                ),
            );
    };
    const importFile = (file: File | undefined) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const value = JSON.parse(String(reader.result));
                save(
                    messages
                        ? value.map(String)
                        : value.map(
                              (item: Fluxo) =>
                                  `${item.titulo ?? ""} :: ${item.caminho ?? ""}`,
                          ),
                );
            } catch {
                window.alert("JSON inválido.");
            }
        };
        reader.readAsText(file);
    };
    return (
        <ToolWindow
            id={messages ? "pending-messages-editor" : "guia-fluxos"}
            title={
                messages
                    ? "EDITOR DE MENSAGENS PENDENTES"
                    : ">_ GUIA_DE_FLUXOS.EXE"
            }
            position={{ top: 100, left: 250 }}
            size={{ width: messages ? 560 : 600, height: messages ? 440 : 550 }}
            color={messages ? "#22c55e" : "#ef4444"}
            onClose={onClose}
        >
            <div
                className={`editable-body ${messages ? "messages-editor" : "fluxos-editor"}`}
            >
                {!messages && !editing ? (
                    <div className="fluxo-display-list">
                        {items.map((item, index) => {
                            const [title, ...path] = item.split("::");
                            return (
                                <div
                                    className="fluxo-item"
                                    key={`${index}-${item}`}
                                >
                                    <div className="fluxo-title">
                                        {title.trim()}
                                    </div>
                                    <div className="fluxo-path">
                                        {path.join("::").trim()}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="editable-list">
                        {items.map((item, index) => (
                            <div
                                className="editable-row"
                                key={`${index}-${item}`}
                            >
                                <label>
                                    {messages
                                        ? `MENSAGEM ${index + 1}:`
                                        : "FLUXO (TÍTULO :: CAMINHO):"}
                                </label>
                                <input
                                    value={item}
                                    onChange={(event) => {
                                        const next = [...items];
                                        next[index] = event.target.value;
                                        setItems(next);
                                    }}
                                />
                                <button
                                    className="remove-btn"
                                    onClick={() =>
                                        setItems(
                                            items.filter(
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
                    </div>
                )}
                {!messages && !editing ? (
                    <div className="editor-footer">
                        <button
                            className="settings-btn settings-btn-secondary"
                            onClick={() => setEditing(true)}
                        >
                            EDITAR
                        </button>
                        <button
                            className="settings-btn settings-btn-secondary"
                            onClick={onClose}
                        >
                            FECHAR
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="new-edit-row">
                            <label>
                                {messages
                                    ? "NOVA MENSAGEM:"
                                    : "NOVO FLUXO (TÍTULO :: CAMINHO):"}
                            </label>
                            <input
                                value={newItem}
                                onChange={(event) =>
                                    setNewItem(event.target.value)
                                }
                                placeholder={
                                    messages
                                        ? "Digite a nova mensagem padrão..."
                                        : "Ex: NOVO FLUXO :: HELP TECH/..."
                                }
                            />
                        </div>
                        <div className="editor-footer">
                            <label className="file-btn">
                                IMPORTAR JSON
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    onChange={(event) =>
                                        importFile(event.target.files?.[0])
                                    }
                                />
                            </label>
                            <button
                                className="settings-btn settings-btn-secondary"
                                onClick={onClose}
                            >
                                FECHAR
                            </button>
                            <button
                                className="settings-btn settings-btn-primary"
                                onClick={() => {
                                    save(
                                        newItem.trim()
                                            ? [...items, newItem]
                                            : items,
                                    );
                                    setNewItem("");
                                    setEditing(!messages);
                                }}
                            >
                                SALVAR
                            </button>
                        </div>
                    </>
                )}
            </div>
        </ToolWindow>
    );
}

function BootScreen({ onDone }: { onDone: () => void }) {
    const [visible, setVisible] = useState(false);
    const [ready, setReady] = useState(false);
    const [lines, setLines] = useState<string[]>([]);
    const audio = useRef<HTMLAudioElement>(null);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localStorage.getItem("last_boot_day") === todayKey()) onDone();
            else {
                setVisible(true);
                setLines([
                    "$ ./firewall_init.sh",
                    "[LOAD] Inicializando Elvis Extension Bridge...",
                    "[LOAD] Chat Monitor Service...",
                    "[LOAD] Rocket.Chat Integration...",
                    "[✓] Todos os módulos carregados",
                ]);
                setTimeout(() => setReady(true), 900);
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [onDone]);
    if (!visible) return null;
    return (
        <div className="boot-screen">
            <div className="boot-card">
                <h1>FIREWALL DA AMIZADE</h1>
                <p>PEDRO ELVIS SOARES NOBREGA</p>
                <div className="boot-text">{lines.join("\n")}</div>
                {ready && (
                    <button
                        className="boot-button"
                        onClick={() => {
                            localStorage.setItem("last_boot_day", todayKey());
                            audio.current?.play().catch(() => undefined);
                            setVisible(false);
                            onDone();
                        }}
                    >
                        INICIAR SISTEMA
                    </button>
                )}
                <audio
                    ref={audio}
                    src={localStorage.getItem("fw_boot_audio") ?? undefined}
                />
            </div>
        </div>
    );
}

export function WorkspaceTools() {
    const [open, setOpen] = useState<Partial<Record<ToolId, boolean>>>({});
    const [bootDone, setBootDone] = useState(false);
    const onBootDone = useCallback(() => setBootDone(true), []);
    const toggle = (id: ToolId) =>
        setOpen((current) => ({ ...current, [id]: !current[id] }));
    const close = (id: ToolId) =>
        setOpen((current) => ({ ...current, [id]: false }));
    const menus = useMemo(() => WORKSPACE_MENUS, []);
    return (
        <>
            <BootScreen onDone={onBootDone} />
            {bootDone && <>
                <div className="workspace-toolbar z-999!">
                    {menus.map((menu) => (
                        <button
                            key={menu.id}
                            className={menu.className}
                            onClick={() => toggle(menu.id)}
                        >
                            {menu.label}
                        </button>
                    ))}
                </div>
                {open.history && <HistoryWindow onClose={() => close("history")} />}
                {open.config && <ConfigWindow onClose={() => close("config")} />}
                {open.notes && <NotesWindow onClose={() => close("notes")} />}
                {open.forponto && <ForpontoWindow onClose={() => close("forponto")} />}
                {open.gx && <GXWindow messages={false} onClose={() => close("gx")} />}
                {open.messages && <GXWindow messages onClose={() => close("messages")} />}
            </>}
        </>
    );
}

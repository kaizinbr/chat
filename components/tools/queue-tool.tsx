"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
} from "react";
import { ROCKET_ORIGIN, TIMING, TOOL_DEFAULTS } from "@/lib/config";
import {
    aggregateFrRooms,
    clearFrCredentials,
    countFrQualifiedAgents,
    filterFrAgents,
    frAgentName,
    frColor,
    frDepartmentIds,
    frInitials,
    frLivechatDotClass,
    frStatusDotClass,
    frStatusLabel,
    hashFrPassword,
    isFrN2,
    readFrAuth,
    readFrCredentials,
    requestFrDashboard,
    requestFrLogin,
    saveFrCredentials,
    saveFrSession,
    sortFrAgents,
    type FrSortMode,
} from "@/lib/fr";
import type { FrDashboardData } from "@/lib/bridge/protocol";
import { ToolWindow } from "./tool-window";

type QueueStatus =
    | "idle"
    | "loading"
    | "ready"
    | "unauthorized"
    | "error";

const SERVER_LABEL = ROCKET_ORIGIN.replace(/^https?:\/\//, "");

/**
 * Porte da pasta original/FR: dashboard de CRs em fila e operadores logados.
 * As chamadas REST são feitas pelo content.js na origem do Rocket (a antiga
 * start.bat usava --disable-web-security só para contornar o CORS).
 */
export function QueueTool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [status, setStatus] = useState<QueueStatus>("idle");
    const [dashboard, setDashboard] = useState<FrDashboardData | null>(null);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const [sortMode, setSortMode] = useState<FrSortMode>("default");
    const [chatsDir, setChatsDir] = useState<"asc" | "desc">("desc");
    const [alphaDir, setAlphaDir] = useState<"asc" | "desc">("asc");

    const [loginUser, setLoginUser] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [loginBusy, setLoginBusy] = useState(false);

    const loadingRef = useRef(false);
    const wasOpen = useRef(false);

    const loadDashboard = useCallback(async (silent = false) => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setRefreshing(true);
        if (!silent) setStatus("loading");

        try {
            let result = await requestFrDashboard(readFrAuth());

            // Mesma reautenticação automática do FR original: usa o digest
            // salvo quando o token de 1 dia expira.
            if (!result.ok && result.unauthorized) {
                const credentials = readFrCredentials();
                if (credentials.username && credentials.digest) {
                    const login = await requestFrLogin(
                        credentials.username,
                        credentials.digest,
                    );
                    if (
                        login.ok &&
                        login.token &&
                        login.userId
                    ) {
                        saveFrSession(
                            login.token,
                            login.userId,
                            credentials.apiUrl,
                        );
                        result = await requestFrDashboard({
                            token: login.token,
                            userId: login.userId,
                        });
                    }
                }
            }

            if (result.ok && result.data) {
                setDashboard(result.data);
                setStatus("ready");
                setError("");
                setLastUpdated(
                    new Date().toLocaleTimeString("pt-BR"),
                );
                return;
            }

            if (result.unauthorized) {
                setDashboard(null);
                setStatus("unauthorized");
                setError(result.error ?? "");
                return;
            }

            setStatus("error");
            setDashboard(null);
            setError(
                result.error ??
                    "Não foi possível consultar a fila no Rocket.Chat.",
            );
        } finally {
            loadingRef.current = false;
            setRefreshing(false);
        }
    }, []);

    // Carrega ao abrir a janela, como o showDashboard() do FR.
    useEffect(() => {
        if (open && !wasOpen.current) void loadDashboard();
        wasOpen.current = open;
    }, [loadDashboard, open]);

    // Atualização automática a cada 10s (mesmo intervalo do original).
    useEffect(() => {
        if (!open || status !== "ready") return;
        const timer = window.setInterval(() => {
            void loadDashboard(true);
        }, TIMING.FR_REFRESH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [loadDashboard, open, status]);

    const agents = useMemo(
        () => filterFrAgents(dashboard?.agents ?? []),
        [dashboard],
    );
    const roomsByAgent = useMemo(
        () => aggregateFrRooms(dashboard?.queueEntries ?? []),
        [dashboard],
    );
    const sortedAgents = useMemo(
        () =>
            sortFrAgents(
                agents,
                roomsByAgent,
                sortMode,
                chatsDir,
                alphaDir,
            ),
        [agents, alphaDir, chatsDir, roomsByAgent, sortMode],
    );
    const counts = useMemo(
        () => ({
            queue: dashboard?.queueCount ?? null,
            total: dashboard
                ? countFrQualifiedAgents(dashboard.agents)
                : 0,
            available: agents.filter(
                (agent) => agent.statusLivechat === "available",
            ).length,
            online: agents.filter((agent) => agent.status === "online")
                .length,
        }),
        [agents, dashboard],
    );

    async function handleLogin(event: FormEvent) {
        event.preventDefault();
        const username = loginUser.trim();
        if (!username || !loginPassword) {
            setError("Preencha usuário e senha.");
            return;
        }

        setLoginBusy(true);
        setError("");
        try {
            const digest = await hashFrPassword(loginPassword);
            const result = await requestFrLogin(username, digest);
            if (!result.ok || !result.token || !result.userId) {
                setError(
                    result.error ??
                        "Usuário ou senha inválidos no Rocket.Chat.",
                );
                return;
            }
            saveFrCredentials(username, digest, ROCKET_ORIGIN);
            saveFrSession(result.token, result.userId, ROCKET_ORIGIN);
            setLoginPassword("");
            await loadDashboard();
        } catch {
            setError("Não foi possível calcular o digest da senha.");
        } finally {
            setLoginBusy(false);
        }
    }

    function handleLogout() {
        clearFrCredentials();
        setDashboard(null);
        setError("");
        setLoginPassword("");
        setStatus("unauthorized");
    }

    function toggleChatsSort() {
        if (sortMode === "chats") {
            setChatsDir((current) => (current === "asc" ? "desc" : "asc"));
            return;
        }
        setSortMode("chats");
        setChatsDir("desc");
    }

    function toggleUnavailableSort() {
        setSortMode((current) =>
            current === "unavailable" ? "default" : "unavailable",
        );
    }

    function toggleAlphaSort() {
        if (sortMode === "alpha") {
            setAlphaDir((current) => (current === "asc" ? "desc" : "asc"));
            return;
        }
        setSortMode("alpha");
        setAlphaDir("asc");
    }

    const user = dashboard?.me;
    const userName = user?.name || user?.username || "";

    return (
        <ToolWindow
            id="fr-window"
            title=">_ FILA_E_OPERADORES.EXE"
            color="#2de0a5"
            defaults={TOOL_DEFAULTS.fila}
            minSize={{ width: 520, height: 460 }}
            headerStyle={{
                background: "rgba(45,224,165,0.08)",
                borderBottom: "1px solid rgba(45,224,165,0.22)",
            }}
            headerActions={
                <button
                    type="button"
                    className="slot-action-btn fr-refresh-btn"
                    onClick={() => void loadDashboard()}
                    disabled={refreshing}
                    title="Atualizar fila agora"
                >
                    ↺ atualizar
                </button>
            }
            open={open}
            onClose={onClose}
        >
            <div className="fr-body">
                {status === "loading" && !dashboard ? (
                    <div className="fr-centered">
                        <span className="fr-spinner" />
                        <span>Carregando operadores...</span>
                    </div>
                ) : null}

                {status === "unauthorized" ? (
                    <form className="fr-login" onSubmit={handleLogin}>
                        <div className="fr-login-head">
                            <h3>Rocket.Chat</h3>
                            <p>Dashboard - Operadores e Fila</p>
                        </div>
                        <p className="fr-login-hint">
                            A sessão do painel é usada automaticamente. Se o
                            Rocket.Chat não estiver logado, entre com suas
                            credenciais abaixo.
                        </p>
                        {error ? (
                            <div className="fr-login-error">{error}</div>
                        ) : null}
                        <label className="fr-field">
                            <span>Usuário</span>
                            <input
                                type="text"
                                value={loginUser}
                                autoComplete="username"
                                placeholder="Seu usuário"
                                onChange={(event) =>
                                    setLoginUser(event.target.value)
                                }
                            />
                        </label>
                        <label className="fr-field">
                            <span>Senha</span>
                            <input
                                type="password"
                                value={loginPassword}
                                autoComplete="current-password"
                                placeholder="Sua senha"
                                onChange={(event) =>
                                    setLoginPassword(event.target.value)
                                }
                            />
                        </label>
                        <div className="fr-login-actions">
                            <button
                                type="submit"
                                className="fr-button fr-button-primary"
                                disabled={loginBusy}
                            >
                                {loginBusy ? "Entrando..." : "Entrar"}
                            </button>
                            <button
                                type="button"
                                className="fr-button"
                                disabled={refreshing}
                                onClick={() => void loadDashboard()}
                            >
                                Usar sessão do Rocket
                            </button>
                        </div>
                        <div className="fr-login-server">
                            Servidor: <b>{SERVER_LABEL}</b>
                        </div>
                    </form>
                ) : null}

                {status === "error" ? (
                    <div className="fr-centered fr-error-state">
                        <b>Não foi possível carregar a fila</b>
                        <p>{error}</p>
                        <button
                            type="button"
                            className="fr-button fr-button-primary"
                            onClick={() => void loadDashboard()}
                        >
                            Tentar novamente
                        </button>
                    </div>
                ) : null}

                {status === "ready" && dashboard ? (
                    <>
                        <div className="fr-userbar">
                            <div
                                className="fr-avatar"
                                style={{
                                    background: frColor(
                                        user?.username ?? "rocket",
                                    ),
                                }}
                            >
                                {frInitials(userName || "?")}
                            </div>
                            <div className="fr-user-meta">
                                <b>{userName || "Operador"}</b>
                                <span>
                                    <i
                                        className={`fr-dot ${frStatusDotClass(
                                            user?.status,
                                        )}`}
                                    />
                                    {frStatusLabel(user?.status)}
                                </span>
                            </div>
                            <span className="fr-server">
                                {SERVER_LABEL}
                            </span>
                            <button
                                type="button"
                                className="fr-link-btn"
                                onClick={handleLogout}
                                title="Remove as credenciais salvas do painel"
                            >
                                sair
                            </button>
                        </div>

                        <div className="gap-4 grid grid-cols-2">
                            <div className="fr-stat fr-stat-queue">
                                <span>CRs em Fila</span>
                                <b className="font-display text-3xl">{counts.queue ?? "—"}</b>
                                <small>Aguardando atendimento</small>
                            </div>
                            <div className="fr-stat">
                                <span>Total de Agentes</span>
                                <b className="font-display text-3xl">{counts.total}</b>
                                <small>
                                    Mais de 12 filas (inclui deslogados)
                                </small>
                            </div>
                            <div className="fr-stat">
                                <span>Disponíveis</span>
                                <b className="font-display text-3xl">{counts.available}</b>
                                <small>Pronto para atender</small>
                            </div>
                            <div className="fr-stat">
                                <span>Agentes Online</span>
                                <b className="font-display text-3xl">{counts.online}</b>
                                <small>Logados no Rocket.Chat</small>
                            </div>
                        </div>

                        <div className="fr-section-head">
                            <h3>Operadores Logados</h3>
                            <span>
                                {sortedAgents.length} operador
                                {sortedAgents.length === 1 ? "" : "es"}
                            </span>
                        </div>

                        <div className="fr-sort-controls">
                            <button
                                type="button"
                                className={`fr-sort-btn ${
                                    sortMode === "chats" ? "active" : ""
                                }`}
                                onClick={toggleChatsSort}
                            >
                                Atendimentos{" "}
                                <span>
                                    {sortMode === "chats"
                                        ? chatsDir === "asc"
                                            ? "↑"
                                            : "↓"
                                        : "↕"}
                                </span>
                            </button>
                            <button
                                type="button"
                                className={`fr-sort-btn ${
                                    sortMode === "unavailable"
                                        ? "active"
                                        : ""
                                }`}
                                onClick={toggleUnavailableSort}
                            >
                                Indisponíveis
                            </button>
                            <button
                                type="button"
                                className={`fr-sort-btn ${
                                    sortMode === "alpha" ? "active" : ""
                                }`}
                                onClick={toggleAlphaSort}
                            >
                                A-Z{" "}
                                <span>
                                    {sortMode === "alpha"
                                        ? alphaDir === "asc"
                                            ? "A→Z"
                                            : "Z→A"
                                        : "↕"}
                                </span>
                            </button>
                        </div>

                        <div className="fr-agent-list">
                            {sortedAgents.length === 0 ? (
                                <div className="fr-empty">
                                    Nenhum agente logado
                                </div>
                            ) : (
                                sortedAgents.map((agent) => {
                                    const name = frAgentName(agent);
                                    const available =
                                        agent.statusLivechat === "available";
                                    return (
                                        <div
                                            className="fr-agent"
                                            key={agent._id}
                                        >
                                            <div
                                                className="fr-avatar"
                                                style={{
                                                    background: frColor(
                                                        agent.username,
                                                    ),
                                                }}
                                            >
                                                {frInitials(name)}
                                            </div>
                                            <div className="fr-agent-info">
                                                <div className="fr-agent-name">
                                                    <b>{name}</b>
                                                    {isFrN2(agent) ? (
                                                        <span className="fr-n2">
                                                            N2
                                                        </span>
                                                    ) : null}
                                                    <span className="fr-dept">
                                                        {
                                                            frDepartmentIds(
                                                                agent,
                                                            ).length
                                                        }{" "}
                                                        filas
                                                    </span>
                                                </div>
                                                <div className="fr-agent-status">
                                                    <i
                                                        className={`fr-balloon ${
                                                            available
                                                                ? "open"
                                                                : "closed"
                                                        }`}
                                                    />
                                                    <span>
                                                        {available
                                                            ? "Balão aberto"
                                                            : "Balão fechado"}
                                                    </span>
                                                    <i
                                                        className={`fr-dot ${frStatusDotClass(
                                                            agent.status,
                                                        )}`}
                                                    />
                                                    <span>
                                                        {frStatusLabel(
                                                            agent.status,
                                                        )}
                                                    </span>
                                                    <i
                                                        className={`fr-dot ${frLivechatDotClass(
                                                            agent,
                                                        )}`}
                                                        title="Aceita novos chats"
                                                    />
                                                </div>
                                            </div>
                                            <div className="fr-agent-count">
                                                <b  className="font-display">
                                                    {roomsByAgent[
                                                        agent._id
                                                    ] ?? 0}
                                                </b>
                                                <span>Atend.</span>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="fr-foot">
                            <span>
                                Atualização automática a cada 10s
                            </span>
                            {lastUpdated ? (
                                <span>Atualizado às {lastUpdated}</span>
                            ) : null}
                        </div>
                    </>
                ) : null}
            </div>
        </ToolWindow>
    );
}

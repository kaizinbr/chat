import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Firewall Workspace",
    description: "Painel de atendimento multi-slot sobre o Rocket.Chat",
};

/**
 * Precisa rodar antes da primeira pintura: aplica o zoom salvo e decide se a
 * tela de boot aparece, sem esperar React (mesmo efeito do script inline do
 * original).
 */
const BOOTSTRAP_SCRIPT = `
(function () {
    try {
        var root = document.documentElement;
        var now = new Date();
        var today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
        if (localStorage.getItem("last_boot_day") === today) {
            root.classList.add("boot-skip");
        } else {
            root.classList.add("boot-active");
        }
        var appScale = parseFloat(localStorage.getItem("fw_app_scale_v1"));
        if (isFinite(appScale) && appScale > 0) {
            root.style.setProperty("--app-scale", appScale.toFixed(2));
        }
        var fontScale = parseFloat(localStorage.getItem("fw_font_scale_v1"));
        if (isFinite(fontScale) && fontScale > 0) {
            root.style.setProperty("--font-scale", fontScale.toFixed(2));
        }
    } catch (error) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
    return (
        <html
            lang="pt-BR"
            className="h-full antialiased"
            suppressHydrationWarning
        >
            <head>
                <script
                    dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SCRIPT }}
                />
            </head>
            <body className="h-full">{children}</body>
        </html>
    );
}

"use client";

import Link from "next/link";

const WORKSPACE_LINKS = [
    { label: "Forponto", href: "https://t-web/ForpontoWeb/Login.aspx" },
    { label: "Rocket", href: "https://helptechho.digitalaec.com.br/home" },
    { label: "GX TI", href: "https://srv_gx_ti.grupoaec.com.br/" },
    { label: "NE1", href: "https://pmc-ne1.aec.com.br" },
    { label: "NE2", href: "https://pmc-ne2.aec.com.br" },
    { label: "NE3", href: "https://pmc-ne3.aec.com.br" },
    { label: "SE1", href: "https://pmc-se1.aec.com.br" },
];

/** Barra inferior de atalhos externos. As janelas de ferramentas vivem em WorkspaceTools. */
export function WorkspaceLinks() {
    return (
        <div className="z-100 gap-1.5 flex items-center justify-center fixed bottom-0 right-4 h-8 bg-black/50 border-b border-white/10 translate-y-1">
            {WORKSPACE_LINKS.map((link) => (
                <Link
                    key={link.label}
                    href={link.href}
                    className="text-link-main border border-link-border border-b-0 bg-link-bg px-4 py-2 rounded-t-xl text-sm font-mono shadow-link opacity-80 hover:opacity-100 transition-opacity"
                    target="_blank"
                >
                    {link.label} →
                </Link>
            ))}
        </div>
    );
}

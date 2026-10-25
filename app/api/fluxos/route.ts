import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { normalizeFluxoList, type Fluxo } from "@/lib/fluxos";

const filePath = path.join(process.cwd(), "public", "fluxos.json");

async function readFluxos(): Promise<Fluxo[]> {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return normalizeFluxoList(JSON.parse(raw));
    } catch {
        return [];
    }
}

export async function GET() {
    return NextResponse.json(await readFluxos());
}

async function writeFluxos(request: Request) {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { error: "JSON inválido." },
            { status: 400 },
        );
    }

    if (!Array.isArray(body)) {
        return NextResponse.json(
            { error: "O corpo deve ser uma lista de fluxos." },
            { status: 400 },
        );
    }

    const fluxos = normalizeFluxoList(body);
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(
            filePath,
            `${JSON.stringify(fluxos, null, 2)}\n`,
            "utf8",
        );
    } catch (error) {
        return NextResponse.json(
            {
                error: `Falha ao gravar fluxos.json: ${
                    (error as Error).message
                }`,
            },
            { status: 500 },
        );
    }

    return NextResponse.json({ ok: true, fluxos });
}

export async function PUT(request: Request) {
    return writeFluxos(request);
}

export async function POST(request: Request) {
    return writeFluxos(request);
}

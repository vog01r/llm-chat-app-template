/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Persona "Casus" (assistant JdR) — toujours en français
const SYSTEM_PROMPT = [
	"Tu es Casus, un assistant de jeu de rôle (JdR) en français.",
	"Ton but: aider à créer des aventures, PNJ, intrigues, ambiances, règles maison, scènes, et à maîtriser des parties.",
	"Style: clair, vivant, concret, orienté action; propose des options; pose 1–3 questions quand une info manque.",
	"Ne révèle pas d'infos non demandées. Évite les pavés: utilise des listes courtes et des titres.",
	"Sécurité: pas de contenu illégal; si un sujet est sensible, recentre vers une alternative sûre.",
].join("\n");

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Parse JSON request body
		const { messages = [], casus } = (await request.json()) as {
			messages: ChatMessage[];
			casus?: {
				mode?: "mj" | "joueur";
				univers?: string;
				style?: string;
			};
		};

		const lastUser = [...messages].reverse().find((m) => m.role === "user");
		const commandResponse = lastUser ? handleCommand(lastUser.content) : null;
		if (commandResponse) {
			return sseTextResponse(commandResponse);
		}

		// Always ensure base "Casus" persona is present
		const hasCasusSystem = messages.some(
			(msg) => msg.role === "system" && msg.content.includes("Tu es Casus"),
		);
		if (!hasCasusSystem) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		// Optional runtime "profile" (mode/univers/style) from the UI
		const profile = buildCasusProfileSystemMessage(casus);
		if (profile) {
			// Put right after the base persona for best effect
			const insertAt = Math.min(
				1,
				messages.findIndex((m) => m.role !== "system"),
			);
			const idx = insertAt === -1 ? 1 : insertAt;
			messages.splice(idx, 0, profile);
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
			{
				// Uncomment to use AI Gateway
				// gateway: {
				//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
				//   skipCache: false,      // Set to true to bypass cache
				//   cacheTtl: 3600,        // Cache time-to-live in seconds
				// },
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

function buildCasusProfileSystemMessage(casus?: {
	mode?: "mj" | "joueur";
	univers?: string;
	style?: string;
}): ChatMessage | null {
	if (!casus) return null;
	const mode = casus.mode?.trim();
	const univers = casus.univers?.trim();
	const style = casus.style?.trim();

	const lines: string[] = [];
	if (mode === "mj") lines.push("Mode: MJ (aide à maîtriser, préparer, improviser).");
	if (mode === "joueur")
		lines.push("Mode: Joueur (aide à incarner, proposer des actions, optimiser sans spoiler).");
	if (univers) lines.push(`Univers/ton: ${univers}`);
	if (style) lines.push(`Contraintes de style: ${style}`);

	if (lines.length === 0) return null;
	return { role: "system", content: `Contexte de partie:\n${lines.join("\n")}` };
}

function handleCommand(raw: string): string | null {
	const input = raw.trim();
	if (input.toLowerCase() === "/help") {
		return [
			"Commandes Casus :",
			"- /roll 2d6+1  (ex: /roll d20, /roll 1d20 adv, /roll 1d20 dis)",
			"- /help",
		].join("\n");
	}
	if (input.toLowerCase().startsWith("/roll")) {
		return rollDiceCommand(input);
	}
	return null;
}

function rollDiceCommand(input: string): string {
	const rest = input.replace(/^\/roll/i, "").trim();
	if (!rest) {
		return "Utilisation: `/roll NdM+K` (ex: `/roll 2d6+1`, `/roll d20`, `/roll 1d20 adv`).";
	}

	const tokens = rest.split(/\s+/);
	const expr = tokens[0];
	const mode = tokens.slice(1).join(" ").toLowerCase();

	// NdM(+/-K) où N peut être omis (=> 1)
	const m = expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
	if (!m) {
		return "Format invalide. Exemple: `/roll 2d6+1` ou `/roll d20`.";
	}

	const n = m[1] ? Number(m[1]) : 1;
	const faces = Number(m[2]);
	const mod = m[3] ? Number(m[3]) : 0;

	if (!Number.isFinite(n) || !Number.isFinite(faces) || !Number.isFinite(mod)) {
		return "Expression de dé invalide.";
	}
	if (n < 1 || n > 50) return "Nombre de dés hors limite (1–50).";
	if (faces < 2 || faces > 1000) return "Nombre de faces hors limite (2–1000).";

	const wantAdv = /\badv\b/.test(mode);
	const wantDis = /\bdis\b/.test(mode);

	if ((wantAdv || wantDis) && !(n === 1 && faces === 20)) {
		return "Le mode `adv`/`dis` est supporté uniquement pour `/roll 1d20 adv` ou `/roll 1d20 dis`.";
	}

	if (wantAdv || wantDis) {
		const a = randIntInclusive(1, 20);
		const b = randIntInclusive(1, 20);
		const kept = wantAdv ? Math.max(a, b) : Math.min(a, b);
		const total = kept + mod;
		const modStr = mod === 0 ? "" : mod > 0 ? `+${mod}` : `${mod}`;
		return [
			`🎲 /roll 1d20 ${wantAdv ? "adv" : "dis"}${modStr}`,
			`Jets: ${a}, ${b} → gardé: ${kept}${mod !== 0 ? ` (${modStr})` : ""}`,
			`Total: ${total}`,
		].join("\n");
	}

	const rolls: number[] = [];
	for (let i = 0; i < n; i++) {
		rolls.push(randIntInclusive(1, faces));
	}
	const sum = rolls.reduce((acc, v) => acc + v, 0);
	const total = sum + mod;
	const modStr = mod === 0 ? "" : mod > 0 ? `+${mod}` : `${mod}`;

	return [
		`🎲 /roll ${n}d${faces}${modStr}`,
		`Jets: ${rolls.join(", ")}${mod !== 0 ? ` (${modStr})` : ""}`,
		`Total: ${total}`,
	].join("\n");
}

function randIntInclusive(min: number, max: number): number {
	const lo = Math.ceil(min);
	const hi = Math.floor(max);
	if (hi < lo) throw new Error("Invalid random range");
	const range = hi - lo + 1;
	// Rejection sampling to avoid modulo bias
	const maxUint32 = 0xffffffff;
	const limit = maxUint32 - (maxUint32 % range);
	const buf = new Uint32Array(1);
	while (true) {
		crypto.getRandomValues(buf);
		const x = buf[0];
		if (x < limit) return lo + (x % range);
	}
}

function sseTextResponse(text: string): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				encoder.encode(`data: ${JSON.stringify({ response: text })}\n\n`),
			);
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}

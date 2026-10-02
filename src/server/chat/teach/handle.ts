// /teach turn: review the body, persist an accepted (or LLM-rejected) row,
// return the assistant copy the SSE route ships. No atlas harness.
import { config } from "../../config.ts";
import { captureError, type ErrorContext } from "../../posthog-node.ts";
import type { JsonCall } from "../llm.ts";
import { onDeviceEmbed } from "../../facts/similarity.ts";
import { teachingEmbedText } from "./match.ts";
import { countTeachingWords, TEACH_HELP, TEACH_LENGTH_RULE, TEACH_MAX_WORDS } from "./parse.ts";
import { reviewTeaching } from "./review.ts";
import {
  countTeachingsToday,
  findAcceptedByHash,
  insertTeaching,
  teachingHash,
} from "./store.ts";

export interface TeachTurnResult {
  content: string;
  usage: { input: number; output: number };
  generationId: string | null;
  accepted: boolean;
}

export async function runTeachCommand(opts: {
  userId: string;
  convId: string;
  text: string;
  jsonCall: JsonCall;
  signal?: AbortSignal;
  obs?: ErrorContext;
}): Promise<TeachTurnResult> {
  const empty = { usage: { input: 0, output: 0 }, generationId: null as string | null, accepted: false };
  if (!opts.text) {
    return { content: TEACH_HELP, ...empty };
  }

  // Over the embedder's window (see TEACH_MAX_WORDS). Rejected before any
  // model call, but STORED as a rejected row like an LLM rejection, so the
  // audit trail shows whether users actually want long notes — the signal for
  // whether sentence-level chunking is worth building.
  const words = countTeachingWords(opts.text);
  if (words > TEACH_MAX_WORDS) {
    try {
      await insertTeaching({
        userId: opts.userId,
        conversationId: opts.convId,
        content: opts.text,
        subject: "",
        status: "rejected",
        rejectReason: "too long",
        contentHash: teachingHash(opts.text),
        reviewModel: null,
        review: { accept: false, reason: "too long", words },
      });
    } catch (err) {
      captureError(err, opts.obs, { stage: "teach_insert_rejected" });
    }
    return {
      content: `That note is ${words} words; I can only remember notes under ${TEACH_MAX_WORDS}. ${TEACH_LENGTH_RULE}`,
      ...empty,
    };
  }

  const today = await countTeachingsToday(opts.userId);
  if (today >= config.chatTeachMaxPerDay) {
    return {
      content: `You've taught me ${today} notes in the last day (the cap is ${config.chatTeachMaxPerDay}). Try again tomorrow.`,
      ...empty,
    };
  }

  const hash = teachingHash(opts.text);
  const existing = await findAcceptedByHash(opts.userId, hash);
  if (existing) {
    return {
      content: "I already have that note — I'll keep using it on your future chats.",
      ...empty,
    };
  }

  const review = await reviewTeaching(opts.text, opts.jsonCall, { signal: opts.signal, obs: opts.obs });
  if (!review.accept) {
    if (review.model) {
      try {
        await insertTeaching({
          userId: opts.userId,
          conversationId: opts.convId,
          content: opts.text,
          subject: review.subject,
          status: "rejected",
          rejectReason: review.reason,
          contentHash: hash,
          reviewModel: review.model,
          review: { accept: false, reason: review.reason, subject: review.subject },
        });
      } catch (err) {
        captureError(err, opts.obs, { stage: "teach_insert_rejected" });
      }
    }
    const why = review.reason && review.reason !== "heuristic" ? ` (${review.reason})` : "";
    return {
      content: `I couldn't save that as a teaching${why}. Try a short, concrete note about what I should remember — a name, where it lives in the Atlas, or how it relates to something I missed.`,
      usage: review.usage,
      generationId: review.generationId,
      accepted: false,
    };
  }

  // Embedded once, here, on-device (~2ms) — never again on a chat turn.
  const ternlight = onDeviceEmbed(teachingEmbedText(review.subject, opts.text));
  await insertTeaching({
    userId: opts.userId,
    conversationId: opts.convId,
    content: opts.text,
    subject: review.subject,
    status: "accepted",
    rejectReason: null,
    contentHash: hash,
    reviewModel: review.model,
    review: { accept: true, reason: review.reason, subject: review.subject },
    ternlight: ternlight ? Array.from(ternlight) : null,
  });

  const subject = review.subject ? ` as “${review.subject}”` : "";
  return {
    content: `Saved${subject}. I'll use this note on your future chats when it matches the question. Teachings stay private to your account.`,
    usage: review.usage,
    generationId: review.generationId,
    accepted: true,
  };
}

import { useState, useSyncExternalStore } from "react";
import { getJobs, jobFor, startJob, subscribeJobs, cancelJob, dismissJob } from "@/lib/studio/jobs";
import { pickSpark, randomRequest, sampleForShot } from "@/lib/studio/prompt";
import { providerReady, titleFromText, useStudio } from "@/lib/studio/store";
import type { ChatMessage } from "@/lib/studio/types";

export function useChatSend(onNeedKey: () => void) {
  const activeId = useStudio((s) => s.activeId);
  const jobs = useSyncExternalStore(subscribeJobs, getJobs, getJobs);
  const live = jobs.find((job) => job.conversationId === activeId) ?? null;
  const [draft, setDraft] = useState("");
  const [missing, setMissing] = useState<string | null>(null);

  function stop() {
    if (activeId) cancelJob(activeId);
  }

  function clearError() {
    setMissing(null);
    if (activeId) dismissJob(activeId);
  }

  function send(text?: string) {
    const typed = (text ?? draft).trim();
    const free = text === undefined && !typed;
    const value = free ? "お任せ" : typed;
    if (!value) return;
    setMissing(null);
    const state = useStudio.getState();
    const busyHere = Boolean(activeId && jobFor(activeId)?.status === "running");
    if (!providerReady(state.provider, state)) {
      onNeedKey();
      setMissing(
        state.provider === "cloudflare"
          ? "Cloudflare のアカウントIDとキーを接続に入れてください。"
          : "APIキーがまだありません。接続から入れてください。",
      );
      if (!free) setDraft(value);
      return;
    }
    let id = state.activeId;
    if (busyHere || !id || !state.conversations.some((item) => item.id === id)) {
      id = state.createConversation();
    }
    const conversation = useStudio.getState().conversations.find((item) => item.id === id);
    if (!conversation) return;
    const history: ChatMessage[] = [
      ...conversation.messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: value,
        createdAt: Date.now(),
      },
    ];
    useStudio.getState().commitMessages(
      id,
      history,
      conversation.messages.length === 0 ? titleFromText(value) : undefined,
    );
    setDraft("");
    startJob(id, history);
  }

  function sendRandom(onEmpty: () => void) {
    const state = useStudio.getState();
    const pool = state.words.filter((item) => item.enabled && item.tag.trim());
    if (!pool.length) {
      onEmpty();
      setMissing("ワードバンクに、オンのタグがありません。");
      return;
    }
    const asked = state.randomCount;
    const picked = sampleForShot(pool, asked, state.shot);
    if (!picked.length) {
      setMissing("今のボタンでは、引けるタグがありません。");
      return;
    }
    send(randomRequest(picked, asked, pickSpark(state.shot.women ?? 1), state.shot));
  }

  function regenerate() {
    const state = useStudio.getState();
    const conversation = state.conversations.find((item) => item.id === state.activeId);
    if (!conversation) return;
    if (jobFor(conversation.id)?.status === "running") return;
    if (!providerReady(state.provider, state)) {
      onNeedKey();
      return;
    }
    let history = conversation.messages;
    if (history.at(-1)?.role === "assistant") history = history.slice(0, -1);
    if (history.at(-1)?.role !== "user") return;
    useStudio.getState().commitMessages(conversation.id, history);
    startJob(conversation.id, history);
  }

  function editRequest(messageId: string, text: string) {
    const value = text.trim();
    if (!value) return;
    const state = useStudio.getState();
    const conversation = state.conversations.find((item) => item.id === state.activeId);
    if (!conversation) return;
    if (jobFor(conversation.id)?.status === "running") return;
    if (!providerReady(state.provider, state)) {
      onNeedKey();
      return;
    }
    const index = conversation.messages.findIndex((item) => item.id === messageId);
    if (index < 0 || conversation.messages[index]?.role !== "user") return;
    const history = conversation.messages.slice(0, index + 1).map((item, itemIndex) =>
      itemIndex === index ? { ...item, content: value } : item,
    );
    useStudio.getState().commitMessages(conversation.id, history, index === 0 ? titleFromText(value) : undefined);
    startJob(conversation.id, history);
  }

  return {
    draft,
    setDraft,
    streaming: live?.status === "running",
    live: live?.status === "running" ? live : null,
    error: live?.status === "error" ? live.error : missing,
    send,
    sendRandom,
    stop,
    regenerate,
    editRequest,
    clearError,
    background: jobs.filter((job) => job.status === "running" && job.conversationId !== activeId).length,
  };
}

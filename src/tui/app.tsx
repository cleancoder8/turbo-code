import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { layout } from "./layout.js";
import { Sidebar, sidebarMaxScroll } from "./sidebar.js";
import { Composer, Processing, Welcome } from "./screen.js";
import { PermissionPrompt, permissionClickChoice, permissionLayout, permissionOptions, type PermissionStage } from "./permission.js";
import type { LspService, LspStatus } from "../lsp/service.js";
import type { UsageSnapshot } from "../session/usage.js";
import type { Agent } from "../agent/index.js";
import type { Decision, Request as PermRequest } from "../permission/types.js";
import { runAgent, wirePerms } from "./agentbridge.js";
import {
  assistantBlock,
  errorBlock,
  footer as renderFooter,
  pagePad,
  toolCard,
  toolCardOverflow,
  toolResult,
  userBlock,
  thinkingLine,
  thoughtLine,
  turnLine,
} from "./blocks.js";
import { colors } from "./theme.js";
import { clickEvents, disableMouse, enableMouse, wheelEvents } from "./mouse.js";

export interface AppProps {
  agent: Agent;
  modelID: string;
  sessionID: string;
  cwd: string;
  branch?: string;
  ask: (req: PermRequest) => Promise<Decision>;
  lsp?: LspService;
  contextWindow?: number;
}

interface PendingPerm {
  req: PermRequest;
  resolve: (d: Decision) => void;
}

type Block = { kind: "user" | "assistant" | "tool" | "result" | "error" | "thought" | "turn"; text: string; extra?: string; ok?: boolean; id?: string; output?: string; expanded?: boolean };
type TranscriptRow = { text: string; expandableBlock?: number };

export function App({ agent, modelID, sessionID: _sessionID, cwd, branch, ask: _ask, lsp, contextWindow }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  const termHeight = stdout?.rows ?? 24;
  const screenHeight = Math.max(8, termHeight - 1);

  const [blocks, setBlocks] = useState<Block[]>(() => agent.session.messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ kind: m.role as "user" | "assistant", text: m.content })));
  const [sidebarOverride, setSidebarOverride] = useState<boolean | undefined>();
  const [narrowStatus, setNarrowStatus] = useState(false);
  const [lspStatus, setLspStatus] = useState<LspStatus[]>(lsp?.snapshot() ?? []);
  const [usage, setUsage] = useState<UsageSnapshot>(agent.usage?.snapshot() ?? {
    turn: { inputTokens: 0, outputTokens: 0 }, session: { inputTokens: 0, outputTokens: 0 }, partial: true,
  });
  const [usageTurn, setUsageTurn] = useState<string>();
  const geom = layout(termWidth, sidebarOverride);
  const chatInset = 2;
  const mainWidth = geom.chatWidth - 2 * chatInset;
  const transcriptWidth = Math.max(10, mainWidth - 2);
  // Leave one cell before the scroll gutter so Ink never adds a truncation
  // ellipsis to a full-width styled row at the pane edge.
  const chatTermWidth = Math.max(1, transcriptWidth - 1) + 2 * pagePad;
  const runId = useRef(0);
  const [stream, setStream] = useState("");
  const [status, setStatus] = useState("ready");
  const [pendingPerm, setPendingPerm] = useState<PendingPerm | null>(null);
  const [permissionStage, setPermissionStage] = useState<PermissionStage>("choose");
  const [permissionChoice, setPermissionChoice] = useState<Decision | "back">("allow_once");
  const [permissionScroll, setPermissionScroll] = useState(0);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingPhase, setProcessingPhase] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef("");
  const pendingTextRef = useRef("");
  const modelDoneRef = useRef<{ inputTokens: number; outputTokens: number; elapsed: number } | null>(null);
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnStartRef = useRef(0);
  const awaitingTextRef = useRef(false);
  const [awaitingText, setAwaitingText] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [sidebarScroll, setSidebarScroll] = useState(0);
  const welcome = blocks.length === 0 && stream === "" && !busy;
  const activeTool = blocks.some((block) => block.kind === "tool" && block.output === undefined);
  const sidebarTitle = blocks.find((b) => b.kind === "user")?.text.split("\n", 1)[0] ?? agent.session.meta.title;
  const sessionTokens = usage.session.inputTokens + usage.session.outputTokens;
  const tokenLabel = sessionTokens >= 1000 ? `${(sessionTokens / 1000).toFixed(1)}K` : String(sessionTokens);
  const contextPercent = contextWindow && usage.lastRequest ? ` (${Math.round(usage.lastRequest.inputTokens / contextWindow * 100)}%)` : "";
  const transientStatus = status === "error" || status === "cancelled" || status === "cancelling…" ? `${status} · ` : "";
  const chatStatus = `${tokenLabel}${contextPercent} · ${transientStatus}ctrl+b sidebar`;

  useEffect(() => {
    wirePerms(agent, (req) =>
      new Promise<Decision>((resolve) => {
        setPermissionStage("choose");
        setPermissionChoice("allow_once");
        setPermissionScroll(0);
        setPendingPerm({ req, resolve });
      }),
    );
  }, [agent]);
  useEffect(() => lsp?.subscribe(setLspStatus), [lsp]);
  useEffect(() => {
    if (!stdout?.isTTY) return;
    stdout.write(`\x1b]11;${colors.bg}\x07${enableMouse}`);
    return () => { stdout.write(`${disableMouse}\x1b]111\x07`); };
  }, [stdout]);
  useEffect(() => () => { if (drainTimerRef.current) clearInterval(drainTimerRef.current); }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setProcessingPhase((phase) => (phase + 1) % 8), 120);
    return () => clearInterval(timer);
  }, [busy]);

  const flushStream = useCallback(() => {
    const cur = streamRef.current;
    if (cur === "") return;
    setBlocks((b) => [...b, { kind: "assistant", text: cur }]);
    streamRef.current = "";
    setStream("");
  }, []);

  const onSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "" || busy) return;
      flushStream();
      setBlocks((b) => [...b, { kind: "user", text: trimmed }]);
      setStatus("thinking…");
      setInput("");
      setBusy(true);
      turnStartRef.current = Date.now();
      awaitingTextRef.current = true;
      setAwaitingText(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const thisRun = ++runId.current;
      pendingTextRef.current = "";
      modelDoneRef.current = null;
      if (drainTimerRef.current) clearInterval(drainTimerRef.current);
      drainTimerRef.current = setInterval(() => {
        if (runId.current !== thisRun) return;
        const queued = pendingTextRef.current;
        if (queued) {
          // Let short replies unfold at a readable pace, then catch up quickly
          // when a large response is already waiting in the queue.
          const count = queued.length <= 120 ? 2 :
            Math.min(256, 2 + Math.ceil((queued.length - 120) / 12));
          streamRef.current += queued.slice(0, count);
          pendingTextRef.current = queued.slice(count);
          setStream(streamRef.current);
        } else if (modelDoneRef.current) {
          const amount = modelDoneRef.current;
          modelDoneRef.current = null;
          if (drainTimerRef.current) clearInterval(drainTimerRef.current);
          drainTimerRef.current = null;
          flushStream();
          setBlocks((b) => [...b, { kind: "turn", text: String(amount.elapsed) }]);
          setStatus(`in ${amount.inputTokens} · out ${amount.outputTokens} tokens`);
          setBusy(false);
          abortRef.current = null;
        }
      }, 30);
      setUsageTurn(undefined);
      if (agent.usage) setUsage(agent.usage.snapshot());

      void runAgent(agent, trimmed, ctrl.signal, {
        onText: (t) => {
          if (runId.current !== thisRun) return;
          if (awaitingTextRef.current && t) {
            awaitingTextRef.current = false;
            setAwaitingText(false);
            setBlocks((b) => [...b, { kind: "thought", text: String(Date.now() - turnStartRef.current) }]);
          }
          pendingTextRef.current += t;
        },
        onToolStart: (callId, name, args) => {
          if (runId.current !== thisRun) return;
          streamRef.current += pendingTextRef.current;
          pendingTextRef.current = "";
          flushStream();
          const firstActivity = awaitingTextRef.current;
          if (firstActivity) {
            awaitingTextRef.current = false;
            setAwaitingText(false);
          }
          setBlocks((b) => [...b,
            ...(firstActivity ? [{ kind: "thought" as const, text: String(Date.now() - turnStartRef.current) }] : []),
            { kind: "tool", id: callId, text: name, extra: args },
          ]);
        },
        onToolEnd: (callId, ok, output) => {
          if (runId.current !== thisRun) return;
          setBlocks((b) => b.some((block) => block.kind === "tool" && block.id === callId)
            ? b.map((block) => block.kind === "tool" && block.id === callId ? { ...block, output, ok } : block)
            : [...b, { kind: "result", text: output, ok }]);
        },
        onUsage: (_amount, turnId) => {
          if (runId.current !== thisRun) return;
          setUsageTurn(turnId);
          setUsage(agent.usage?.snapshot(turnId) ?? { turn: _amount, session: _amount, lastRequest: _amount, partial: true });
        },
        onDone: (usage) => {
          if (runId.current !== thisRun) return;
          if (ctrl.signal.aborted) return;
          if (awaitingTextRef.current) {
            awaitingTextRef.current = false;
            setAwaitingText(false);
            setBlocks((b) => [...b, { kind: "thought", text: String(Date.now() - turnStartRef.current) }]);
          }
          modelDoneRef.current = { ...usage, elapsed: Date.now() - turnStartRef.current };
        },
        onError: (e) => {
          if (runId.current !== thisRun) return;
          awaitingTextRef.current = false;
          setAwaitingText(false);
          if (drainTimerRef.current) clearInterval(drainTimerRef.current);
          drainTimerRef.current = null;
          streamRef.current += pendingTextRef.current;
          pendingTextRef.current = "";
          flushStream();
          if (!ctrl.signal.aborted) setBlocks((b) => [...b, { kind: "error", text: e.message }]);
          setStatus(ctrl.signal.aborted ? "cancelled" : "error");
          setBusy(false);
          abortRef.current = null;
        },
      }).finally(() => {
        if (runId.current !== thisRun) return;
        if (modelDoneRef.current) return;
        if (drainTimerRef.current) clearInterval(drainTimerRef.current);
        drainTimerRef.current = null;
        awaitingTextRef.current = false;
        setAwaitingText(false);
        setBusy(false); abortRef.current = null;
        setStatus((s) => s === "cancelling…" ? "cancelled" : s);
      });
    },
    [agent, busy, flushStream],
  );

  const answerPerm = useCallback(
    (d: Decision) => {
      if (!pendingPerm) return;
      pendingPerm.resolve(d);
      setPendingPerm(null);
    },
    [pendingPerm],
  );

  const selectPermission = (choice: Decision | "back") => {
    if (choice === "back") {
      setPermissionStage("choose");
      setPermissionChoice("allow_always");
      setPermissionScroll(0);
    } else if (choice === "allow_always" && permissionStage === "choose") {
      setPermissionStage("always");
      setPermissionChoice("allow_always");
      setPermissionScroll(0);
    } else answerPerm(choice);
  };

  const permissionPanel = pendingPerm ? permissionLayout(pendingPerm.req, mainWidth, screenHeight, permissionStage, permissionScroll) : undefined;
  const transcriptHeight = Math.max(1, screenHeight - 7 - (permissionPanel ? permissionPanel.height + 1 : 0));
  const transcriptRows = useMemo(() => {
    const rows: TranscriptRow[] = [];
    for (const [index, b] of blocks.entries()) {
      let rendered: string;
      switch (b.kind) {
        case "user": rendered = userBlock(b.text, chatTermWidth); break;
        case "assistant": rendered = assistantBlock(b.text, chatTermWidth); break;
        case "tool": rendered = toolCard(b.text, b.extra ?? "", b.output, b.ok, chatTermWidth, b.expanded); break;
        case "result": rendered = toolResult(!!b.ok, b.text, chatTermWidth); break;
        case "error": rendered = errorBlock(b.text, chatTermWidth); break;
        case "thought": rendered = thoughtLine(Number(b.text)); break;
        case "turn": rendered = turnLine(modelID, Number(b.text)); break;
      }
      const expandableBlock = b.kind === "tool" && toolCardOverflow(b.text, b.output, chatTermWidth) ? index : undefined;
      rows.push(...rendered.split("\n").map((text) => ({ text, expandableBlock })), { text: "" });
    }
    if (awaitingText) rows.push({ text: thinkingLine() });
    if (stream) rows.push(...assistantBlock(stream, chatTermWidth).split("\n").map((text) => ({ text })));
    return rows;
  }, [blocks, stream, awaitingText, chatTermWidth, modelID]);
  const maxScroll = Math.max(0, transcriptRows.length - transcriptHeight);
  const offset = Math.min(scrollOffset, maxScroll);
  const firstVisible = Math.max(0, transcriptRows.length - transcriptHeight - offset);
  const visibleRows = transcriptRows.slice(firstVisible, firstVisible + transcriptHeight);
  const previousLineCount = useRef(transcriptRows.length);
  useEffect(() => {
    const added = transcriptRows.length - previousLineCount.current;
    previousLineCount.current = transcriptRows.length;
    if (added > 0) setScrollOffset((old) => old > 0 ? Math.min(maxScroll, old + added) : old);
  }, [transcriptRows.length, maxScroll]);
  useInput((input, key) => {
    if (key.ctrl && input === "c") { pendingPerm?.resolve("deny"); abortRef.current?.abort(); exit(); return; }
    if (key.ctrl && input === "x") {
      pendingPerm?.resolve("deny"); setPendingPerm(null);
      abortRef.current?.abort(); if (busy) setStatus("cancelling…"); return;
    }
    if (key.escape && busy && !pendingPerm) {
      abortRef.current?.abort();
      setStatus("cancelling…");
      return;
    }
    if (pendingPerm) {
      const wheel = wheelEvents(input);
      if (wheel.length > 0) {
        for (const event of wheel) setPermissionScroll((old) => Math.max(0, Math.min(permissionPanel?.maxScroll ?? 0, old - event.direction)));
        return;
      }
      const clicks = clickEvents(input);
      if (clicks.length > 0) {
        for (const click of clicks) {
          if (click.y !== transcriptHeight + (permissionPanel?.height ?? 0) - ((permissionPanel?.footerRows ?? 2) - 1)) continue;
          const choice = permissionClickChoice(click.x, chatInset + 1, mainWidth, permissionStage);
          if (choice) selectPermission(choice);
        }
        return;
      }
      if (key.upArrow) setPermissionScroll((old) => Math.max(0, old - 1));
      else if (key.downArrow) setPermissionScroll((old) => Math.min(permissionPanel?.maxScroll ?? 0, old + 1));
      else if (key.leftArrow || input === "h" || key.rightArrow || input === "l") {
        const options = permissionOptions(permissionStage);
        const index = options.findIndex((option) => option.decision === permissionChoice);
        const next = (index + (key.leftArrow || input === "h" ? options.length - 1 : 1)) % options.length;
        setPermissionChoice(options[next]!.decision);
      } else if (key.return) selectPermission(permissionChoice);
      else if (input === "y" && permissionStage === "choose") selectPermission("allow_once");
      else if (input === "a") selectPermission("allow_always");
      else if (input === "n" || key.escape) selectPermission(permissionStage === "always" ? "back" : "deny");
      return;
    }
    if (key.ctrl && input === "b") {
      if (termWidth < 110) setNarrowStatus((v) => !v);
      else setSidebarOverride((v) => !(v ?? termWidth >= 110));
      return;
    }
    const wheel = wheelEvents(input);
    if (wheel.length > 0) {
      for (const event of wheel) {
        if (geom.sidebarVisible && event.x > geom.chatWidth) {
          setSidebarScroll((old) => Math.max(0, Math.min(sidebarMaxScroll(screenHeight, lspStatus), old - event.direction * 3)));
        } else if (event.y <= transcriptHeight) {
          setScrollOffset((old) => Math.max(0, Math.min(maxScroll, old + event.direction * 3)));
        }
      }
      return;
    }
    const clicks = clickEvents(input);
    if (clicks.length > 0) {
      if (!welcome && !narrowStatus) for (const click of clicks) {
        if (click.x <= chatInset || click.x > geom.chatWidth - chatInset || click.y < 1 || click.y > transcriptHeight) continue;
        const index = visibleRows[click.y - 1]?.expandableBlock;
        if (index !== undefined) setBlocks((current) => current.map((block, i) =>
          i === index ? { ...block, expanded: !block.expanded } : block));
      }
      return;
    }
    if (key.pageUp || (key.ctrl && key.upArrow)) {
      setScrollOffset((old) => Math.min(maxScroll, old + Math.max(1, transcriptHeight - 3)));
      return;
    }
    if (key.pageDown || (key.ctrl && key.downArrow)) {
      setScrollOffset((old) => Math.max(0, old - Math.max(1, transcriptHeight - 3)));
      return;
    }
    if (key.escape && narrowStatus) setNarrowStatus(false);
  });

  return <Box flexDirection="column" paddingX={pagePad} width={termWidth} height={screenHeight}>
    {welcome ? <>
      <Welcome width={geom.width} model={modelID} value={input} busy={busy} onChange={setInput} onSubmit={onSubmit} />
      <Text>{renderFooter(cwd, "turbo-code v0.1.0", termWidth)}</Text>
    </> :
      <Box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
        {narrowStatus ? <Sidebar width={geom.width} height={screenHeight} title={sidebarTitle} usage={usage} lsp={lspStatus} contextWindow={contextWindow} cwd={cwd} branch={branch} scrollOffset={sidebarScroll} /> : <>
          <Box width={geom.chatWidth} flexDirection="column" flexGrow={1} overflow="hidden" paddingLeft={chatInset} paddingRight={chatInset}>
            <Box flexDirection="row" height={transcriptHeight} overflow="hidden">
              <Box width={transcriptWidth} flexDirection="column" overflow="hidden">
                {visibleRows.map((row, i) => <Text key={`${firstVisible + i}-${i}`} wrap="truncate-end">{row.text || " "}</Text>)}
              </Box>
              <Box width={1} />
              <Box width={1} flexDirection="column">
                {Array.from({ length: transcriptHeight }, (_, i) => {
                  const thumbHeight = Math.max(1, Math.floor(transcriptHeight * transcriptHeight / Math.max(transcriptHeight, transcriptRows.length)));
                  const thumbStart = maxScroll === 0 ? 0 : Math.round((maxScroll - offset) / maxScroll * (transcriptHeight - thumbHeight));
                  return <Text key={i} color={i >= thumbStart && i < thumbStart + thumbHeight && maxScroll > 0 ? colors.border : colors.element}>{maxScroll > 0 ? "┃" : " "}</Text>;
                })}
              </Box>
            </Box>
            {pendingPerm && <Box marginBottom={1}><PermissionPrompt req={pendingPerm.req} width={mainWidth} screenHeight={screenHeight} stage={permissionStage} selected={permissionChoice} scroll={permissionScroll} /></Box>}
            <Composer width={mainWidth} model={modelID} value={input} busy={busy} busyLabel={activeTool ? "Running tool…" : awaitingText ? "Thinking…" : "Writing…"} onChange={setInput} onSubmit={onSubmit} spacious />
            {busy ? <Processing phase={processingPhase} /> : <Box height={1} />}
            <Text>{renderFooter(cwd, chatStatus, mainWidth)}</Text>
          </Box>
          {geom.sidebarVisible && <Sidebar width={geom.sidebarWidth} height={screenHeight} title={sidebarTitle} usage={usage} lsp={lspStatus} contextWindow={contextWindow} cwd={cwd} branch={branch} scrollOffset={sidebarScroll} />}
        </>}
      </Box>}
  </Box>;
}

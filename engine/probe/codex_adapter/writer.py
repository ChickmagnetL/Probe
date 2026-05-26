from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import ExtractionBuffers, OPTIONAL_JSONL_TABLES, REQUIRED_JSONL_TABLES


def write_outputs(
    output_dir: str | Path,
    buffers: ExtractionBuffers,
    summary: dict[str, Any],
) -> Path:
    target_dir = Path(output_dir).expanduser().resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    write_json(target_dir / "file_manifest.json", {"files": buffers.file_manifest})
    for table_name in REQUIRED_JSONL_TABLES:
        write_jsonl(target_dir / f"{table_name}.jsonl", getattr(buffers, table_name))

    for table_name in OPTIONAL_JSONL_TABLES:
        rows = getattr(buffers, table_name)
        if rows:
            write_jsonl(target_dir / f"{table_name}.jsonl", rows)

    write_json(target_dir / "summary.json", summary)
    write_html_report(target_dir / "index.html", summary)
    return target_dir


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    content = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows
    )
    path.write_text(content, encoding="utf-8")


def write_html_report(path: Path, summary: dict[str, Any]) -> None:
    root_sessions = summary.get("root_sessions") or summary.get("sessions", [])

    html_template = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Probe - Turn Axis View</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        :root {
            --bg: #ffffff;
            --text: #1a1a1a;
            --text-dim: #666666;
            --border: #e0e0e0;
            --accent: #007aff;
            --user: #007aff;
            --assistant: #34c759;
            --tool: #5856d6;
            --reasoning: #af52de;
            --sidebar-bg: #f5f5f7;
            --panel-bg: rgba(255, 255, 255, 0.98);
        }

        * { box-sizing: border-box; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }

        /* Sidebar */
        aside { width: 340px; border-right: 1px solid var(--border); background: var(--sidebar-bg); display: flex; flex-direction: column; z-index: 100; box-shadow: 2px 0 10px rgba(0,0,0,0.02); }
        .sidebar-header { padding: 24px; border-bottom: 1px solid var(--border); background: #fff; }
        .sidebar-header h1 { margin: 0; font-size: 1rem; font-weight: 700; color: #000; }
        .session-list { flex: 1; overflow-y: auto; padding: 12px; }
        
        .session-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; transition: all 0.2s; border: 1px solid transparent; }
        .session-item:hover { background: rgba(0,0,0,0.035); }
        .session-item.active { background: #fff; border-color: var(--border); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .session-name { font-weight: 600; font-size: 0.85rem; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .session-meta { font-size: 0.75rem; color: var(--text-dim); }
        .session-item > div > div { overflow: hidden; }
        .session-item .session-name, .session-item > div > div > div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .sidebar-session-group.collapsed > .child-sessions { display: none; }
        .child-sessions { margin-left: 14px; border-left: 1.5px solid #e5e5e5; padding-left: 6px; margin-top: 4px; }
        .collapse-toggle { width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 9px; color: var(--text-dim); transition: transform 0.2s; }
        .sidebar-session-group.collapsed > .session-item .collapse-toggle { transform: rotate(-90deg); }

        /* Main Content */
        main { flex: 1; position: relative; background: #fff; overflow: hidden; }
        #graph { width: 100%; height: 100%; cursor: grab; }
        #graph:active { cursor: grabbing; }

        /* Graph Elements */
        .node { stroke-width: 2px; cursor: pointer; transition: opacity 0.4s; }
        .node circle { transition: r 0.3s, stroke-width 0.3s; }
        .node-label { font-size: 11px; font-weight: 500; fill: var(--text-dim); pointer-events: none; user-select: none; transition: opacity 0.4s; }
        .link { stroke: #ddd; stroke-opacity: 0.4; stroke-width: 1.5px; fill: none; transition: opacity 0.4s, stroke-opacity 0.4s; }
        .link.primary { stroke: #bbb; stroke-width: 3px; stroke-opacity: 0.7; }
        .link.branch { stroke-dasharray: 3,3; stroke-opacity: 0.4; }
        
        .dimmed { opacity: 0.08 !important; }
        .link.dimmed { stroke-opacity: 0.04 !important; }
        .node.active circle { stroke: var(--accent); stroke-width: 4px; }
        .node.synthetic circle { stroke-dasharray: 4,2; stroke: #999; }
        
        /* Special Node Styles */
        .node.anchor circle { stroke-width: 3px; }
        .node.is-first-input circle { stroke: var(--user); stroke-width: 5px; r: 12; }
        .node.is-final-output circle { stroke: var(--assistant); stroke-width: 5px; r: 12; }

        /* Detail Panel */
        #detailPanel { position: absolute; top: 0; right: 0; width: 380px; height: 100%; background: var(--panel-bg); border-left: 1px solid var(--border); transform: translateX(100%); transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); backdrop-filter: blur(28px); box-shadow: -15px 0 45px rgba(0,0,0,0.06); display: flex; flex-direction: column; z-index: 200; }
        #detailPanel.open { transform: translateX(0); }
        .detail-header { padding: 32px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: flex-start; }
        .detail-header-text { flex: 1; }
        .detail-header h2 { margin: 0; font-size: 1.15rem; font-weight: 700; line-height: 1.4; letter-spacing: -0.01em; }
        .detail-header p { margin: 6px 0 0; font-size: 0.85rem; color: var(--text-dim); }
        .close-btn { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-dim); padding: 4px; line-height: 1; border-radius: 8px; margin-top: -6px; margin-right: -8px; transition: all 0.2s; }
        .close-btn:hover { background: rgba(0,0,0,0.05); color: #000; }
        
        .detail-content { flex: 1; min-height: 0; overflow-y: auto; padding: 32px; }
        .detail-section { margin-bottom: 32px; }
        .detail-section h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); margin: 0 0 12px; font-weight: 700; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .metric-card { background: #f9f9f9; padding: 16px; border-radius: 12px; border: 1px solid var(--border); }
        .metric-label { font-size: 0.65rem; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
        .metric-value { font-weight: 600; font-size: 0.95rem; color: var(--text); }
        pre { background: #f5f5f7; padding: 20px; border-radius: 14px; font-family: "JetBrains Mono", "SF Mono", monospace; font-size: 0.82rem; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; margin: 0; border: 1px solid var(--border); color: #2c3e50; }
        .formatted-block { background: linear-gradient(180deg, #fbfbfd 0%, #f4f6fb 100%); border: 1px solid #dfe5f0; border-radius: 16px; overflow: hidden; }
        .formatted-header { padding: 12px 16px; border-bottom: 1px solid #dfe5f0; background: rgba(255,255,255,0.78); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
        .formatted-title { font-size: 0.76rem; font-weight: 700; color: #243042; letter-spacing: 0.04em; text-transform: uppercase; }
        .formatted-note { font-size: 0.75rem; color: var(--text-dim); }
        .formatted-block pre { margin: 0; border: none; border-radius: 0; background: transparent; }
        .structured-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .structured-grid { display: grid; gap: 0; }
        .structured-row { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 14px; align-items: start; padding: 14px 0; border-top: 1px solid #e7ebf3; }
        .structured-row:first-child { border-top: none; padding-top: 0; }
        .structured-value .structured-row { grid-template-columns: 110px minmax(0, 1fr); gap: 10px; }
        .structured-value .structured-value .structured-row { grid-template-columns: 90px minmax(0, 1fr); gap: 8px; }
        .structured-key { font-size: 0.72rem; font-weight: 700; color: #5e6b7c; text-transform: uppercase; letter-spacing: 0.05em; }
        .structured-value { min-width: 0; color: #223041; font-size: 0.84rem; line-height: 1.7; }
        .structured-pill-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .structured-pill { display: inline-flex; align-items: center; max-width: 100%; padding: 4px 10px; border-radius: 999px; background: #eef3fb; border: 1px solid #d8e2f3; color: #28415f; font-size: 0.78rem; line-height: 1.5; }
        .structured-array { display: grid; gap: 12px; }
        .structured-array-item { border: 1px solid #e5eaf2; border-radius: 14px; background: #fff; overflow: hidden; }
        .structured-array-label { padding: 10px 14px; border-bottom: 1px solid #edf1f7; background: #f8fafc; font-size: 0.72rem; font-weight: 700; color: #607086; letter-spacing: 0.05em; text-transform: uppercase; }
        .structured-array-body { padding: 0 14px 14px; }
        .structured-block { background: #fff; border: 1px solid #e3e7ef; border-radius: 14px; overflow: hidden; }
        .structured-block pre { margin: 0; background: transparent; border: none; border-radius: 0; }
        .structured-section-title { font-size: 0.72rem; font-weight: 700; color: #5e6b7c; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
        .structured-subsection { display: grid; gap: 12px; }
        .source-list { display: grid; gap: 12px; margin-top: 14px; }
        .source-card { background: #fff; border: 1px solid #e3e7ef; border-radius: 14px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(21, 33, 55, 0.04); }
        .source-card h4 { margin: 0 0 8px; font-size: 0.88rem; line-height: 1.45; color: #1f2a38; }
        .source-card p { margin: 0; font-size: 0.8rem; line-height: 1.6; color: #526071; white-space: pre-wrap; }
        .source-meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.72rem; color: #5f6d7d; }
        .source-chip { padding: 4px 8px; border-radius: 999px; background: #eef3fb; border: 1px solid #d8e2f3; }
        .semantic-card { display: grid; gap: 14px; }
        .semantic-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 16px 18px; border: 1px solid #dbe4f3; border-radius: 14px; background: linear-gradient(180deg, #ffffff 0%, #f7faff 100%); }
        .semantic-card-kicker { font-size: 0.72rem; font-weight: 700; color: #66768c; letter-spacing: 0.05em; text-transform: uppercase; }
        .semantic-card-title { margin-top: 6px; font-size: 1rem; font-weight: 700; color: #1f2a38; line-height: 1.4; }
        .semantic-section { display: grid; gap: 10px; }
        .semantic-text-block { padding: 16px 18px; border: 1px solid #e1e7f0; border-radius: 14px; background: #fff; color: #334255; font-size: 0.83rem; line-height: 1.75; white-space: pre-wrap; }
        .schema-card { display: grid; gap: 12px; }
        .schema-field-list { display: grid; gap: 12px; }
        .schema-field { padding: 14px 16px; border: 1px solid #e1e7f0; border-radius: 14px; background: #fff; display: grid; gap: 10px; }
        .schema-field-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
        .schema-field-name { font-size: 0.88rem; font-weight: 700; color: #223041; line-height: 1.5; }
        .schema-field-meta { display: flex; flex-wrap: wrap; gap: 8px; }
        .schema-field-description { font-size: 0.8rem; color: #526071; line-height: 1.7; white-space: pre-wrap; }
        .schema-summary { display: flex; flex-wrap: wrap; gap: 8px; }

        .more-info-toggle { cursor: pointer; padding: 12px; background: #f5f5f7; border-radius: 8px; margin-top: 16px; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600; color: var(--text); border: 1px solid var(--border); transition: all 0.2s; }
        .more-info-toggle:hover { background: #eee; }
        .more-info-content { max-height: 0; overflow: hidden; transition: max-height 0.3s ease; }
        .more-info-content.expanded { max-height: none; overflow-y: auto; }
        .more-info-content pre { max-height: 600px; overflow-y: auto; }

        /* Controls */
        .controls { position: absolute; bottom: 32px; left: 32px; display: flex; flex-direction: column; gap: 10px; z-index: 100; }
        .btn { background: #fff; border: 1px solid var(--border); padding: 10px 18px; border-radius: 10px; cursor: pointer; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); transition: all 0.2s; }
        .btn:hover { background: #f8f8f8; transform: translateY(-1px); }

        /* Legend */
        .legend { position: absolute; top: 32px; right: 32px; background: rgba(255,255,255,0.85); padding: 18px; border-radius: 16px; border: 1px solid var(--border); font-size: 0.72rem; display: flex; flex-direction: column; gap: 8px; z-index: 100; backdrop-filter: blur(12px); box-shadow: 0 4px 24px rgba(0,0,0,0.04); }
        .legend-item { display: flex; align-items: center; gap: 10px; color: var(--text-dim); font-weight: 500; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
        
        .synthetic-hint { background: #fff4e5; border: 1px solid #ff9800; color: #e65100; padding: 12px 16px; border-radius: 10px; font-size: 0.8rem; line-height: 1.5; margin-bottom: 24px; display: none; }
        .synthetic-hint.visible { display: block; }
    </style>
</head>
<body>
    <aside>
        <div class="sidebar-header">
            <h1>分析报告 · 交互流视图</h1>
        </div>
        <div class="session-list" id="sessionList"></div>
    </aside>

    <main>
        <svg id="graph"></svg>
        <div class="legend">
            <div class="legend-item"><div class="legend-dot" style="background: var(--user)"></div> 用户输入 (主轴)</div>
            <div class="legend-item"><div class="legend-dot" style="background: var(--assistant)"></div> AI 最终回复 (主轴)</div>
            <div class="legend-item"><div class="legend-dot" style="background: #ccc; width:6px; height:6px;"></div> 过程细节 (分支)</div>
        </div>
        <div class="controls">
            <button class="btn" onclick="resetView()">全部重置</button>
            <button class="btn" onclick="toggleLabels()">切换标签</button>
        </div>
        <div id="detailPanel">
            <div class="detail-header">
                <div class="detail-header-text">
                    <h2 id="detailTitle">详情</h2>
                    <p id="detailSubtitle"></p>
                </div>
                <button class="close-btn" onclick="closePanel()">&times;</button>
            </div>
            <div class="detail-content">
                <div id="syntheticHint" class="synthetic-hint">
                    <strong>数据缺失提示：</strong> 此会话的完整记录未包含在输入中。由于缺少主对话，子代理目前看起来直接从同一点开辟。
                </div>
                <div id="detailContent"></div>
            </div>
        </div>
    </main>

    <script>
        const rootSessions = __ROOT_SESSIONS__;
        const sessionMap = new Map();
        const eventMap = new Map();
        const sessionToRootMap = new Map();
        
        let currentRootId = null;
        let showLabels = false;
        let graphData = { nodes: [], links: [] };
        let currentSidebarFocusSessionId = null;

        function sourceOrder(a, b) {
            const lineA = Number.isFinite(a?.source_line_no) ? a.source_line_no : Number.MAX_SAFE_INTEGER;
            const lineB = Number.isFinite(b?.source_line_no) ? b.source_line_no : Number.MAX_SAFE_INTEGER;
            if (lineA !== lineB) return lineA - lineB;
            const timeA = a?.timestamp ? Date.parse(a.timestamp) : Number.MAX_SAFE_INTEGER;
            const timeB = b?.timestamp ? Date.parse(b.timestamp) : Number.MAX_SAFE_INTEGER;
            if (timeA !== timeB) return timeA - timeB;
            return String(a?.event_id || '').localeCompare(String(b?.event_id || ''));
        }

        function indexSessions(sessions, rootId, parentId = null) {
            sessions.forEach(s => {
                s.parent_session_id = parentId;
                sessionMap.set(s.session_id, s);
                sessionToRootMap.set(s.session_id, rootId);
                (s.events || []).forEach(e => eventMap.set(e.event_id, e));
                (s.child_sessions || []).forEach(c => indexSessions([c], rootId, s.session_id));
            });
        }
        rootSessions.forEach(root => indexSessions([root], root.session_id));

        function primaryNodeIdForSession(sessionId) {
            const session = sessionMap.get(sessionId);
            if (!session) return null;
            for (const turn of (session.graph_turns || [])) {
                if (turn.input?.event_id) return turn.input.event_id;
                if (turn.output?.event_id) return turn.output.event_id;
                const firstInputDetail = (turn.input_details || []).find(item => item?.event_id);
                if (firstInputDetail?.event_id) return firstInputDetail.event_id;
                const firstOutputDetail = (turn.output_details || []).find(item => item?.event_id);
                if (firstOutputDetail?.event_id) return firstOutputDetail.event_id;
            }
            return null;
        }

        function collectSessionSubtreeIds(sessionId, target = new Set()) {
            const session = sessionMap.get(sessionId);
            if (!session || target.has(sessionId)) return target;
            target.add(sessionId);
            (session.child_sessions || []).forEach(child => collectSessionSubtreeIds(child.session_id, target));
            return target;
        }

        function formatTokenCountK(value) {
            if (!Number.isFinite(value) || value <= 0) return '';
            const asK = value / 1000;
            const fixed = asK >= 100 ? asK.toFixed(0) : asK.toFixed(2);
            const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\\.$/, '') : fixed;
            return `${trimmed}K token`;
        }

        function formatUsageLabelK(usage) {
            if (!usage) return '';
            if (Number.isFinite(usage.input_tokens) || Number.isFinite(usage.output_tokens)) {
                const inputText = formatTokenCountK(usage.input_tokens || 0) || '0K token';
                const outputText = formatTokenCountK(usage.output_tokens || 0) || '0K token';
                return `${inputText} 输入 / ${outputText} 输出`;
            }
            return formatTokenCountK(usage.total_tokens || 0);
        }

        const svg = d3.select("#graph");
        const main = d3.select("main");
        let width = main.node().clientWidth;
        let height = main.node().clientHeight;
        const g = svg.append("g");
        const zoom = d3.zoom().scaleExtent([0.02, 5]).on("zoom", (event) => g.attr("transform", event.transform));
        svg.call(zoom);

        let linksLayer = g.append("g").attr("class", "links");
        let nodesLayer = g.append("g").attr("class", "nodes");

        function buildRootGraphData(rootId) {
            const root = sessionMap.get(rootId);
            if (!root) return { nodes: [], links: [] };

            const nodes = [];
            const links = [];
            const visited = new Set();
            const verticalSpacing = 140;
            const branchSpacingX = 180;
            const laneWidth = 550;

            function processSession(s, startX, startY, entrySourceId = null) {
                if (visited.has(s.session_id)) return { width: 0, endY: startY };
                visited.add(s.session_id);

                const turns = s.graph_turns || [];
                const firstInput = turns.find(turn => turn.input)?.input || null;
                const lastOutput = [...turns].reverse().find(turn => turn.output && turn.output.kind === 'assistant_output')?.output || null;
                let currentY = startY;
                let lastAnchorId = null;
                let maxLaneX = startX + laneWidth;
                let entryLinked = false;

                function linkFromPrevious(targetId, type = 'primary', isBranch = false, isPrimary = false) {
                    if (lastAnchorId) {
                        links.push({ source: lastAnchorId, target: targetId, type, isBranch, isPrimary });
                        return;
                    }
                    if (entrySourceId && !entryLinked) {
                        links.push({ source: entrySourceId, target: targetId, type: 'spawn' });
                        entryLinked = true;
                    }
                }

                // Layout Turns
                turns.forEach(turn => {
                    // 1. User Input Anchor
                    if (turn.input) {
                        const isFirst = turn.input.event_id === firstInput?.event_id;
                        const inputNode = {
                            id: turn.input.event_id,
                            type: 'event',
                            kind: 'user_input',
                            name: turn.input.summary || turn.input.title,
                            x: startX,
                            y: currentY,
                            val: isFirst ? 13 : 10,
                            color: 'var(--user)',
                            event: turn.input,
                            sessionId: s.session_id,
                            isAnchor: true,
                            isFirstInput: isFirst
                        };
                        nodes.push(inputNode);
                        linkFromPrevious(inputNode.id, 'primary', false, true);
                        lastAnchorId = inputNode.id;

                        // Input Branches follow source line order
                        const inputDetails = [...(turn.input_details || [])].sort(sourceOrder);
                        inputDetails.forEach((item, idx) => {
                            const detailNode = {
                                id: item.event_id,
                                type: 'event',
                                kind: item.kind,
                                name: item.summary || item.title,
                                x: startX - branchSpacingX,
                                y: inputNode.y + (idx + 1) * 35,
                                val: 5,
                                color: toneColor(item.kind),
                                event: item,
                                sessionId: s.session_id,
                                isDetail: true
                            };
                            nodes.push(detailNode);
                            links.push({ source: inputNode.id, target: detailNode.id, type: 'branch', isBranch: true });
                        });
                        currentY += verticalSpacing;
                    }

                    // 2. Assistant Output Anchor
                    if (turn.output) {
                        const isFinal = turn.output.kind === 'assistant_output' && turn.output.event_id === lastOutput?.event_id;
                        const outputNode = {
                            id: turn.output.event_id,
                            type: 'event',
                            kind: turn.output.kind,
                            name: turn.output.summary || turn.output.title,
                            x: startX,
                            y: currentY,
                            val: isFinal ? 13 : 10,
                            color: 'var(--assistant)',
                            event: turn.output,
                            sessionId: s.session_id,
                            isAnchor: true,
                            isFinalOutput: isFinal
                        };
                        nodes.push(outputNode);
                        links.push({ source: lastAnchorId, target: outputNode.id, type: 'primary', isPrimary: true });
                        lastAnchorId = outputNode.id;

                        // Output Branches follow source line order
                        const outputDetails = [...(turn.output_details || [])].sort(sourceOrder);
                        let detailOffset = 0;
                        outputDetails.forEach(item => {
                            if (item.kind === 'subagent_session') {
                                const child = sessionMap.get(item.child_session_id);
                                if (!child) return;
                                const childStartY = outputNode.y + (detailOffset + 1) * 35;
                                const res = processSession(child, startX + laneWidth, childStartY, outputNode.id);
                                maxLaneX = Math.max(maxLaneX, startX + laneWidth + res.width);
                                detailOffset += 1;
                                return;
                            }

                            const detailNode = {
                                id: item.event_id,
                                type: 'event',
                                kind: item.kind,
                                name: item.summary || item.title,
                                x: startX + branchSpacingX,
                                y: outputNode.y + (detailOffset + 1) * 35,
                                val: 5,
                                color: toneColor(item.kind),
                                event: item,
                                sessionId: s.session_id,
                                isDetail: true
                            };
                            nodes.push(detailNode);
                            links.push({ source: outputNode.id, target: detailNode.id, type: 'branch', isBranch: true });
                            detailOffset += 1;
                        });
                        currentY += verticalSpacing;
                    } else if ((turn.output_details || []).length > 0 && !turn.input) {
                        // Loose output details before any input/output anchor
                        [...turn.output_details].sort(sourceOrder).forEach(item => {
                            const detailNode = {
                                id: item.event_id,
                                type: 'event',
                                kind: item.kind,
                                name: item.summary || item.title,
                                x: startX + branchSpacingX,
                                y: currentY,
                                val: 5,
                                color: toneColor(item.kind),
                                event: item,
                                sessionId: s.session_id
                            };
                            nodes.push(detailNode);
                            if (lastAnchorId) {
                                links.push({ source: lastAnchorId, target: detailNode.id, type: 'branch', isBranch: true });
                            } else if (entrySourceId && !entryLinked) {
                                links.push({ source: entrySourceId, target: detailNode.id, type: 'spawn' });
                                entryLinked = true;
                            }
                            currentY += 40;
                        });
                    }
                });

                return { width: maxLaneX - startX, endY: currentY };
            }

            processSession(root, 0, 100);
            return { nodes, links };
        }

        function toneColor(kind) {
            if (kind === 'user_input') return 'var(--user)';
            if (kind.startsWith('input_')) return 'var(--user)';
            if (kind === 'assistant_output' || kind === 'assistant_update') return 'var(--assistant)';
            if (kind === 'tool_call' || kind === 'tool_output') return 'var(--tool)';
            if (kind.startsWith('reasoning')) return 'var(--reasoning)';
            return '#ccc';
        }

        function switchRoot(rootId, targetId = null, options = {}) {
            currentRootId = rootId;
            graphData = buildRootGraphData(rootId);
            renderGraph();
            currentSidebarFocusSessionId = options.fromSidebar ? (options.sidebarSessionId || null) : null;
            const resolvedTargetId = targetId || primaryNodeIdForSession(rootId);
            if (resolvedTargetId) setTimeout(() => focusOn(resolvedTargetId, options), 50);
            else resetView();
            updateSidebarActive(options.sidebarSessionId || targetId || resolvedTargetId || rootId);
        }

        function renderGraph() {
            linksLayer.selectAll("*").remove();
            nodesLayer.selectAll("*").remove();

            linksLayer.selectAll("path")
                .data(graphData.links)
                .enter().append("path")
                .attr("class", d => `link ${d.isPrimary ? 'primary' : ''} ${d.isBranch ? 'branch' : ''}`)
                .attr("d", d => {
                    const s = graphData.nodes.find(n => n.id === d.source);
                    const t = graphData.nodes.find(n => n.id === d.target);
                    if (d.type === 'spawn') {
                        return `M${s.x},${s.y} C${s.x},${(s.y+t.y)/2} ${t.x},${(s.y+t.y)/2} ${t.x},${t.y}`;
                    }
                    if (d.isBranch) {
                        // Use a curved branch link
                        const cp1x = (s.x + t.x) / 2;
                        const cp1y = s.y;
                        return `M${s.x},${s.y} Q${cp1x},${s.y} ${t.x},${t.y}`;
                    }
                    return `M${s.x},${s.y} L${t.x},${t.y}`;
                });

            const nodes = nodesLayer.selectAll("g")
                .data(graphData.nodes)
                .enter().append("g")
                .attr("class", d => `node ${d.type} ${d.isAnchor ? 'anchor' : ''} ${d.is_synthetic ? 'synthetic' : ''} ${d.isFirstInput ? 'is-first-input' : ''} ${d.isFinalOutput ? 'is-final-output' : ''}`)
                .attr("transform", d => `translate(${d.x},${d.y})`)
                .on("click", (event, d) => {
                    event.stopPropagation();
                    currentSidebarFocusSessionId = null;
                    focusOn(d.id);
                });

            nodes.append("circle").attr("r", d => d.val).attr("fill", d => d.color);
            nodes.append("text").attr("class", "node-label").attr("dx", d => d.val + 10).attr("dy", ".35em").text(d => d.kind || d.type).style("display", showLabels ? "block" : "none");
        }

        function focusOn(id, options = {}) {
            const d = graphData.nodes.find(n => n.id === id);
            if (!d) {
                const rootId = sessionToRootMap.get(id);
                const fallbackId = primaryNodeIdForSession(id);
                if (rootId && fallbackId && fallbackId !== id) switchRoot(rootId, fallbackId, options);
                return;
            }

            const requestedSessionId = options.fromSidebar
                ? (options.sidebarSessionId || null)
                : currentSidebarFocusSessionId;
            const requestedSession = requestedSessionId ? sessionMap.get(requestedSessionId) : null;
            const shouldDimForSidebarChild = !!(requestedSession && requestedSession.parent_session_id);

            if (shouldDimForSidebarChild) {
                const activeSessionIds = collectSessionSubtreeIds(requestedSessionId);
                svg.selectAll(".node")
                    .classed("dimmed", n => !activeSessionIds.has(n.sessionId))
                    .classed("active", n => n.id === id);
                svg.selectAll(".link")
                    .classed("dimmed", l => {
                        const sourceNode = graphData.nodes.find(n => n.id === l.source);
                        const targetNode = graphData.nodes.find(n => n.id === l.target);
                        return !(
                            sourceNode &&
                            targetNode &&
                            activeSessionIds.has(sourceNode.sessionId) &&
                            activeSessionIds.has(targetNode.sessionId)
                        );
                    });
            } else {
                svg.selectAll(".node").classed("dimmed", false).classed("active", n => n.id === id);
                svg.selectAll(".link").classed("dimmed", false);
            }

            // Keep user-selected zoom scale; only pan to center the clicked node.
            const panelOpen = document.getElementById('detailPanel').classList.contains('open');
            const panelWidth = panelOpen ? 380 : 0;
            const visibleWidth = width - panelWidth;
            const centerX = visibleWidth / 2;
            const currentTransform = d3.zoomTransform(svg.node());
            const transform = d3.zoomIdentity
                .translate(centerX - d.x * currentTransform.k, height / 2 - d.y * currentTransform.k)
                .scale(currentTransform.k);
            svg.transition().duration(800).call(zoom.transform, transform);
            showDetail(d);
            updateSidebarActive(d.id);
        }

        function resetView() {
            currentSidebarFocusSessionId = null;
            svg.selectAll(".node").classed("dimmed", false).classed("active", false);
            svg.selectAll(".link").classed("dimmed", false);
            svg.transition().duration(800).call(zoom.transform, d3.zoomIdentity.translate(width/2 - 100, 100).scale(0.5));
            closePanel();
        }

        function updateSidebarActive(id) {
            document.querySelectorAll('.session-item').forEach(el => el.classList.remove('active'));
            const sessionId = sessionMap.has(id) ? id : (graphData.nodes.find(n => n.id === id)?.sessionId || id);
            const sideEl = document.querySelector(`[data-session-id="${sessionId}"]`);
            if (sideEl) { sideEl.classList.add('active'); let p = sideEl.closest('.sidebar-session-group'); while(p){p.classList.remove('collapsed'); p=p.parentElement.closest('.sidebar-session-group');} }
        }

        function renderSidebar() {
            const list = document.getElementById("sessionList");
            function formatTime(isoString) {
                if (!isoString) return '';
                const date = new Date(isoString);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${month}-${day} ${hours}:${minutes}`;
            }
            function renderItem(s) {
                const children = s.child_sessions || [];
                const timeStr = formatTime(s.start_time);

                // Get first user input content directly (not summary)
                let firstUserInput = '';
                const turns = s.graph_turns || [];
                for (const turn of turns) {
                    if (turn.input) {
                        firstUserInput = turn.input.content || turn.input.summary;
                        break;
                    }
                }
                const displayName = s.agent_role === 'guardian' ? s.display_name : (firstUserInput || s.display_name);

                return `<div class="sidebar-session-group" id="group-${s.session_id}">
                    <div class="session-item" data-session-id="${s.session_id}" onclick="switchRoot('${sessionToRootMap.get(s.session_id)}', primaryNodeIdForSession('${s.session_id}') || '${s.session_id}', { fromSidebar: true, sidebarSessionId: '${s.session_id}' })">
                        <div style="display:flex; align-items:center;">
                            ${children.length ? `<span class="collapse-toggle" onclick="event.stopPropagation(); toggleCollapse('${s.session_id}')">▼</span>` : '<span style="width:22px"></span>'}
                            <div style="flex:1; min-width:0;">
                                <div class="session-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>
                                ${timeStr ? `<div style="font-size:0.7rem; color:#999; margin-top:2px;">${timeStr}</div>` : ''}
                            </div>
                        </div>
                    </div>
                    ${children.length ? `<div class="child-sessions">${children.map(renderItem).join('')}</div>` : ''}
                </div>`;
            }
            list.innerHTML = rootSessions.map(renderItem).join("");
        }
        renderSidebar();

        function toggleCollapse(id) { document.getElementById(`group-${id}`).classList.toggle('collapsed'); }
        function showDetail(d) {
            const panel = document.getElementById("detailPanel");
            const detailScrollContainer = panel.querySelector(".detail-content");
            panel.classList.add("open");
            const s = sessionMap.get(d.sessionId || d.id);
            const e = d.type === 'session' ? null : d.event;

            const titleText = d.type === 'session' ? '会话起点' : (d.event?.title || d.event?.kind || d.kind || '节点详情');
            document.getElementById("detailTitle").innerText = titleText;
            document.getElementById("detailSubtitle").innerText = d.type === 'session'
                ? s.display_name
                : (e?.intro || '');

            const hint = document.getElementById("syntheticHint");
            hint.classList.toggle("visible", !!s?.is_synthetic);

            if (d.type === 'session') {
                const sourcePath = s.source_path ? s.source_path.split('/').pop() : '';
                const elapsedSec = s.metrics?.elapsed_sec;
                const rawJson = s.source_record ? JSON.stringify(s.source_record, null, 2) : (s.source_raw_text || JSON.stringify(s, null, 2));
                document.getElementById("detailContent").innerHTML = `
                    <div class="detail-section">
                        <h3>会话信息</h3>
                        <div class="metric-card">包含 ${s.metrics.display_node_count} 个对话点</div>
                    </div>
                    ${typeof elapsedSec === 'number' ? `<div class="detail-section"><h3>会话跨度</h3><div class="metric-card">${elapsedSec.toFixed(3)} 秒</div></div>` : ''}
                    <div class="more-info-toggle" onclick="toggleMoreInfo(this)">
                        <span>更多信息</span>
                        <span>▼</span>
                    </div>
                    <div class="more-info-content">
                        <div class="detail-section">
                            <h3>源文件 JSON</h3>
                            <pre>${escapeHtml(rawJson)}</pre>
                            ${sourcePath ? `<div style="margin-top:12px; padding:8px 12px; background:#f0f0f0; border-radius:6px; font-size:0.75rem; color:#666;">来源: ${escapeHtml(sourcePath)}</div>` : ''}
                        </div>
                    </div>`;
                if (detailScrollContainer) detailScrollContainer.scrollTop = 0;
            } else {
                const content = e.content || e.args || e.summary || '';
                const contentLabel = e.content_label || '内容';
                const sourcePath = e.source_path ? e.source_path.split('/').pop() : '';
                const lineNo = e.source_line_no;
                const rawJson = e.source_record ? JSON.stringify(e.source_record, null, 2) : (e.source_raw_text || JSON.stringify(e, null, 2));

                let html = ``;
                if (content) {
                    html += `<div class="detail-section"><h3>${escapeHtml(contentLabel)}</h3>${renderPrimaryContent(e, contentLabel, content)}</div>`;
                }

                if (e.usage) {
                    html += `<div class="detail-section"><h3>Token</h3><div class="metric-card">${escapeHtml(formatUsageLabelK(e.usage) || e.usage.label || '')}</div></div>`;
                    if (typeof e.usage.total_tokens === 'number') {
                        html += `<div class="detail-section"><h3>总量</h3><div class="metric-card">${escapeHtml(formatTokenCountK(e.usage.total_tokens))}</div></div>`;
                    }
                }
                if (typeof e.estimated_input_tokens === 'number' && e.estimated_input_tokens > 0) {
                    html += `<div class="detail-section"><h3>文本 Token（估算）</h3><div class="metric-card">≈ ${escapeHtml(formatTokenCountK(e.estimated_input_tokens))}</div></div>`;
                }
                if (typeof e.task_elapsed_sec === 'number') {
                    html += `<div class="detail-section"><h3>任务耗时</h3><div class="metric-card">${e.task_elapsed_sec.toFixed(3)} 秒</div></div>`;
                }

                html += `
                    <div class="more-info-toggle" onclick="toggleMoreInfo(this)">
                        <span>更多信息</span>
                        <span>▼</span>
                    </div>
                    <div class="more-info-content">
                        <div class="detail-section">
                            <h3>源文件 JSON</h3>
                            <pre>${escapeHtml(rawJson)}</pre>
                            ${sourcePath && lineNo ? `<div style="margin-top:12px; padding:8px 12px; background:#f0f0f0; border-radius:6px; font-size:0.75rem; color:#666;">来源: ${escapeHtml(sourcePath)} 第 ${lineNo} 行</div>` : ''}
                        </div>
                    </div>`;

                document.getElementById("detailContent").innerHTML = html;
                if (detailScrollContainer) detailScrollContainer.scrollTop = 0;
            }
        }

        function toggleMoreInfo(element) {
            const content = element.nextElementSibling;
            const arrow = element.querySelector('span:last-child');
            content.classList.toggle('expanded');
            arrow.textContent = content.classList.contains('expanded') ? '▲' : '▼';
        }
        function tryParseJson(text) {
            if (typeof text !== 'string') return null;
            const trimmed = text.trim();
            if (!trimmed) return null;
            if (!['{', '[', '"'].includes(trimmed[0])) return null;
            try { return JSON.parse(trimmed); } catch { return null; }
        }
        function decodeEscapedText(text) {
            if (typeof text !== 'string' || !text) return text;
            if (!/\\\\(?:[nrt"\\\\]|u[0-9a-fA-F]{4})/.test(text)) return text;
            return text
                .replace(/\\\\r\\\\n/g, '\\n')
                .replace(/\\\\n/g, '\\n')
                .replace(/\\\\r/g, '\\r')
                .replace(/\\\\t/g, '    ')
                .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, hex) => {
                    try {
                        return String.fromCharCode(parseInt(hex, 16));
                    } catch {
                        return `\\\\u${hex}`;
                    }
                })
                .replace(/\\\\"/g, '"')
                .replace(/\\\\\\\\/g, '\\\\');
        }
        function splitToolOutputEnvelope(text) {
            if (typeof text !== 'string') return null;
            const match = text.match(/^Wall time:\\s*(.+?)\\nOutput:\\n([\\s\\S]*)$/);
            if (!match) return null;
            return {
                wallTime: match[1].trim(),
                body: match[2] || ''
            };
        }
        function renderToolExecutionMeta(executionMeta) {
            if (!executionMeta || !executionMeta.wallTime) return '';
            return `
                <div class="structured-subsection">
                    <div class="structured-section-title">工具执行信息</div>
                    <div class="metric-card">耗时 ${escapeHtml(executionMeta.wallTime)}</div>
                </div>
            `;
        }
        function renderSourceCards(sources) {
            if (!Array.isArray(sources) || !sources.length) return '';
            return `<div class="source-list">${sources.map(source => `
                <div class="source-card">
                    <h4>${escapeHtml(source.title || source.url || '来源')}</h4>
                    ${source.description ? `<p>${escapeHtml(decodeEscapedText(source.description))}</p>` : ''}
                    <div class="source-meta">
                        ${source.provider ? `<span class="source-chip">来源: ${escapeHtml(source.provider)}</span>` : ''}
                        ${source.url ? `<span class="source-chip">${escapeHtml(source.url)}</span>` : ''}
                    </div>
                </div>
            `).join('')}</div>`;
        }
        function isPlainObject(value) {
            return value !== null && typeof value === 'object' && !Array.isArray(value);
        }
        function parseMaybeStructuredJson(text) {
            if (typeof text !== 'string') return null;
            const parsed = tryParseJson(text);
            if (parsed !== null) return parsed;
            const decoded = decodeEscapedText(text);
            return decoded !== text ? tryParseJson(decoded) : null;
        }
        function renderStructuredTextBlock(text) {
            return `<div class="structured-block"><pre>${escapeHtml(decodeEscapedText(String(text)))}</pre></div>`;
        }
        function renderStructuredObject(obj, depth) {
            const d = depth || 0;
            const entries = Object.entries(obj || {});
            if (!entries.length) {
                return `<span class="structured-pill">{ }</span>`;
            }
            if (d >= 3) {
                return `<div class="structured-block"><pre>${escapeHtml(JSON.stringify(obj, null, 2))}</pre></div>`;
            }
            return `<div class="structured-grid">${entries.map(([key, value]) => `
                <div class="structured-row">
                    <div class="structured-key">${escapeHtml(key)}</div>
                    <div class="structured-value">${renderStructuredValue(value, d + 1)}</div>
                </div>
            `).join('')}</div>`;
        }
        function renderStructuredValue(value, depth) {
            const d = depth || 0;
            if (value === null || value === undefined) {
                return `<span class="structured-pill">null</span>`;
            }
            if (typeof value === 'string') {
                const decoded = decodeEscapedText(value);
                if (decoded.length <= 120 && !decoded.includes('\\n')) {
                    return `<span class="structured-pill">${escapeHtml(decoded)}</span>`;
                }
                return renderStructuredTextBlock(decoded);
            }
            if (typeof value === 'number' || typeof value === 'boolean') {
                return `<span class="structured-pill">${escapeHtml(String(value))}</span>`;
            }
            if (Array.isArray(value)) {
                return renderStructuredArray(value, d);
            }
            if (isPlainObject(value)) {
                return renderStructuredObject(value, d);
            }
            return renderStructuredTextBlock(String(value));
        }
        function renderStructuredArray(arr, depth) {
            const d = depth || 0;
            if (!arr.length) {
                return `<span class="structured-pill">[]</span>`;
            }
            const allPrimitive = arr.every(item => item === null || typeof item !== 'object');
            if (allPrimitive) {
                return `<div class="structured-pill-list">${arr.map(item => `<span class="structured-pill">${escapeHtml(item === null ? 'null' : decodeEscapedText(String(item)))}</span>`).join('')}</div>`;
            }
            return `<div class="structured-array">${arr.map((item, index) => `
                <div class="structured-array-item">
                    <div class="structured-array-label">第 ${index + 1} 项</div>
                    <div class="structured-array-body">${renderStructuredValue(item, d + 1)}</div>
                </div>
            `).join('')}</div>`;
        }
        function isJsonSchemaDefinition(value) {
            return isPlainObject(value) && (
                typeof value.type === 'string' ||
                isPlainObject(value.properties) ||
                Array.isArray(value.required) ||
                Object.prototype.hasOwnProperty.call(value, 'additionalProperties')
            );
        }
        function isSourceLikeEntry(value) {
            return isPlainObject(value) && (
                typeof value.url === 'string' ||
                typeof value.title === 'string' ||
                typeof value.description === 'string'
            );
        }
        function isSourceLikeCollection(value) {
            return Array.isArray(value) && value.length > 0 && value.every(item => isSourceLikeEntry(item));
        }
        function humanizeFieldLabel(key) {
            const text = String(key || '')
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .trim();
            return text ? text.toUpperCase() : 'FIELD';
        }
        function semanticSectionLabel(key) {
            const lowered = String(key || '').toLowerCase();
            if (lowered.includes('description')) return '说明文本';
            if (lowered.includes('summary')) return '摘要';
            if (lowered.includes('message')) return '消息';
            if (lowered.includes('content') || lowered === 'text' || lowered.endsWith('_text')) return '内容';
            if (lowered.includes('schema')) return '参数定义';
            if (lowered.includes('source')) return '来源列表';
            return humanizeFieldLabel(key);
        }
        function formatSemanticPrimitive(value) {
            if (typeof value === 'string') return decodeEscapedText(value);
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            if (value === null) return 'null';
            return JSON.stringify(value);
        }
        function isShortSemanticPrimitive(value) {
            if (typeof value === 'number' || typeof value === 'boolean' || value === null) return true;
            if (typeof value !== 'string') return false;
            const decoded = decodeEscapedText(value);
            return decoded.length <= 80 && !decoded.includes('\\n');
        }
        function isLongSemanticText(value) {
            if (typeof value !== 'string') return false;
            const decoded = decodeEscapedText(value);
            return decoded.length > 120 || decoded.includes('\\n');
        }
        function preferredSemanticTitleKey(value) {
            const keys = ['name', 'title', 'label', 'id'];
            return keys.find(key => typeof value?.[key] === 'string' && value[key].trim()) || null;
        }
        function analyzeSemanticObject(value) {
            if (!isPlainObject(value)) {
                return {
                    titleKey: null,
                    titleValue: '',
                    metaEntries: [],
                    textEntries: [],
                    schemaEntries: [],
                    sourceEntries: [],
                    nestedEntries: []
                };
            }
            const record = { ...value };
            const titleKey = preferredSemanticTitleKey(record);
            const titleValue = titleKey ? decodeEscapedText(record[titleKey]).trim() : '';
            if (titleKey) delete record[titleKey];
            const metaEntries = [];
            const textEntries = [];
            const schemaEntries = [];
            const sourceEntries = [];
            const nestedEntries = [];

            Object.entries(record).forEach(([key, entryValue]) => {
                if (isJsonSchemaDefinition(entryValue)) {
                    schemaEntries.push([key, entryValue]);
                    return;
                }
                if (isSourceLikeCollection(entryValue)) {
                    sourceEntries.push([key, entryValue]);
                    return;
                }
                if (typeof entryValue === 'string' && (
                    ['description', 'summary', 'message', 'content', 'body', 'reason', 'details', 'text'].includes(String(key).toLowerCase()) ||
                    isLongSemanticText(entryValue)
                )) {
                    textEntries.push([key, entryValue]);
                    return;
                }
                if (isShortSemanticPrimitive(entryValue)) {
                    metaEntries.push([key, entryValue]);
                    return;
                }
                nestedEntries.push([key, entryValue]);
            });

            return {
                titleKey,
                titleValue,
                metaEntries,
                textEntries,
                schemaEntries,
                sourceEntries,
                nestedEntries
            };
        }
        function semanticObjectScore(value) {
            if (!isPlainObject(value)) return -1;
            const analysis = analyzeSemanticObject(value);
            let score = 0;
            if (analysis.titleValue) score += 2;
            if (analysis.textEntries.length) score += 2;
            if (analysis.schemaEntries.length) score += 3;
            if (analysis.sourceEntries.length) score += 2;
            if (analysis.metaEntries.length >= 2) score += 1;
            return score;
        }
        function extractPrimarySemanticEntity(payload) {
            if (!isPlainObject(payload)) {
                return { label: null, entity: payload, companion: {} };
            }
            const directScore = semanticObjectScore(payload);
            let bestCandidate = null;
            Object.entries(payload).forEach(([key, value]) => {
                if (!isPlainObject(value)) return;
                const score = semanticObjectScore(value);
                if (score < 0) return;
                if (!bestCandidate || score > bestCandidate.score) {
                    bestCandidate = { key, value, score };
                }
            });
            if (bestCandidate && bestCandidate.score >= 3 && bestCandidate.score > directScore) {
                const companion = { ...payload };
                delete companion[bestCandidate.key];
                return {
                    label: bestCandidate.key,
                    entity: bestCandidate.value,
                    companion
                };
            }
            return {
                label: null,
                entity: payload,
                companion: {}
            };
        }
        function renderJsonSchemaDefinition(schema) {
            if (!isJsonSchemaDefinition(schema)) {
                return renderStructuredValue(schema, 1);
            }
            const properties = isPlainObject(schema.properties) ? Object.entries(schema.properties) : [];
            const required = new Set(Array.isArray(schema.required) ? schema.required : []);
            const propertyCards = properties.map(([name, definition]) => {
                const field = isPlainObject(definition) ? definition : {};
                const fieldType = typeof field.type === 'string' ? field.type : '';
                const hasDefault = Object.prototype.hasOwnProperty.call(field, 'default');
                const defaultText = hasDefault ? JSON.stringify(field.default) : '';
                const description = typeof field.description === 'string'
                    ? decodeEscapedText(field.description)
                    : '';
                const meta = [
                    fieldType ? `类型: ${fieldType}` : '',
                    required.has(name) ? '必填' : '可选',
                    defaultText ? `默认值: ${defaultText}` : ''
                ].filter(Boolean);
                return `
                    <div class="schema-field">
                        <div class="schema-field-header">
                            <div class="schema-field-name">${escapeHtml(name)}</div>
                            <div class="schema-field-meta">${meta.map(item => `<span class="structured-pill">${escapeHtml(item)}</span>`).join('')}</div>
                        </div>
                        ${description ? `<div class="schema-field-description">${escapeHtml(description)}</div>` : ''}
                    </div>
                `;
            }).join('');
            const summary = [
                typeof schema.type === 'string' ? `根类型: ${schema.type}` : '',
                Array.isArray(schema.required) && schema.required.length ? `必填字段 ${schema.required.length} 个` : '无必填字段',
                Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')
                    ? (schema.additionalProperties ? '允许额外字段' : '禁止额外字段')
                    : ''
            ].filter(Boolean);
            return `
                <div class="schema-card">
                    ${propertyCards
                        ? `<div class="schema-field-list">${propertyCards}</div>`
                        : `<div class="structured-block"><pre>${escapeHtml(JSON.stringify(schema, null, 2))}</pre></div>`}
                    <div class="schema-summary">${summary.map(item => `<span class="structured-pill">${escapeHtml(item)}</span>`).join('')}</div>
                </div>
            `;
        }
        function renderSemanticMetaPills(entries) {
            if (!entries.length) return '';
            return `<div class="structured-pill-list">${entries.map(([key, value]) => `
                <span class="structured-pill">${escapeHtml(`${humanizeFieldLabel(key)}: ${formatSemanticPrimitive(value)}`)}</span>
            `).join('')}</div>`;
        }
        function renderSemanticSectionsFromObject(payload, sectionTitle = null) {
            if (!isPlainObject(payload) || !Object.keys(payload).length) return '';
            const analysis = analyzeSemanticObject(payload);
            let html = '';
            if (analysis.metaEntries.length) {
                html += `
                    <div class="semantic-section">
                        <div class="structured-section-title">${escapeHtml(sectionTitle || '元信息')}</div>
                        ${renderSemanticMetaPills(analysis.metaEntries)}
                    </div>
                `;
            }
            analysis.textEntries.forEach(([key, value]) => {
                html += `
                    <div class="semantic-section">
                        <div class="structured-section-title">${escapeHtml(semanticSectionLabel(key))}</div>
                        <div class="semantic-text-block">${escapeHtml(decodeEscapedText(value).trim())}</div>
                    </div>
                `;
            });
            analysis.schemaEntries.forEach(([key, value]) => {
                html += `
                    <div class="semantic-section">
                        <div class="structured-section-title">${escapeHtml(semanticSectionLabel(key))}</div>
                        ${renderJsonSchemaDefinition(value)}
                    </div>
                `;
            });
            analysis.sourceEntries.forEach(([key, value]) => {
                html += `
                    <div class="semantic-section">
                        <div class="structured-section-title">${escapeHtml(semanticSectionLabel(key))}</div>
                        ${renderSourceCards(value)}
                    </div>
                `;
            });
            analysis.nestedEntries.forEach(([key, value]) => {
                html += `
                    <div class="semantic-section">
                        <div class="structured-section-title">${escapeHtml(semanticSectionLabel(key))}</div>
                        ${renderStructuredValue(value, 1)}
                    </div>
                `;
            });
            return html;
        }
        function renderSemanticEntityCard(payload, options = {}) {
            const entity = isPlainObject(payload) ? payload : {};
            const {
                label = null,
                companionFields = null,
                extraFields = null
            } = options;
            const analysis = analyzeSemanticObject(entity);
            const normalizedExtraFields = isPlainObject(extraFields) ? { ...extraFields } : {};
            delete normalizedExtraFields.text;
            if (typeof normalizedExtraFields.type === 'string') {
                normalizedExtraFields.block_type = normalizedExtraFields.type;
                delete normalizedExtraFields.type;
            }
            const title = analysis.titleValue || (label ? humanizeFieldLabel(label) : '结构化结果');
            const kicker = label ? `主对象 · ${humanizeFieldLabel(label)}` : '结构化结果';
            const companionObject = isPlainObject(companionFields) ? companionFields : {};
            const extraObject = isPlainObject(normalizedExtraFields) ? normalizedExtraFields : {};

            const entitySections = renderSemanticSectionsFromObject(entity);
            const companionSections = renderSemanticSectionsFromObject(companionObject, '同级字段');
            const extraSections = renderSemanticSectionsFromObject(extraObject, '区块属性');

            return `
                <div class="semantic-card">
                    <div class="semantic-card-header">
                        <div>
                            <div class="semantic-card-kicker">${escapeHtml(kicker)}</div>
                            <div class="semantic-card-title">${escapeHtml(title)}</div>
                        </div>
                        ${label ? `<div class="structured-pill-list"><span class="structured-pill">字段: ${escapeHtml(label)}</span></div>` : ''}
                    </div>
                    ${entitySections}
                    ${companionSections}
                    ${extraSections}
                </div>
            `;
        }
        function renderSemanticPayload(payload, options = {}) {
            if (!isPlainObject(payload)) {
                return renderStructuredValue(payload, 1);
            }
            const primary = extractPrimarySemanticEntity(payload);
            const companionFields = isPlainObject(options.companionFields)
                ? { ...primary.companion, ...options.companionFields }
                : primary.companion;
            return renderSemanticEntityCard(primary.entity, {
                label: primary.label || options.label,
                companionFields,
                extraFields: options.extraFields || null
            });
        }
        function unwrapSingleStructuredTextBlock(blocks) {
            if (!Array.isArray(blocks) || blocks.length !== 1) return null;
            const item = blocks[0];
            if (!isPlainObject(item) || typeof item.text !== 'string') return null;
            const parsed = parseMaybeStructuredJson(item.text);
            if (!parsed) return null;
            return {
                payload: parsed,
                blockType: typeof item.type === 'string' ? item.type : null,
                extraFields: item
            };
        }
        function renderMaybeStructuredText(text, depth) {
            const d = depth || 0;
            if (typeof text !== 'string') {
                return renderStructuredValue(text, d);
            }
            const parsed = parseMaybeStructuredJson(text);
            if (Array.isArray(parsed)) {
                return renderStructuredArray(parsed, d);
            }
            if (isPlainObject(parsed)) {
                return renderStructuredObject(parsed, d);
            }
            return renderStructuredTextBlock(decodeEscapedText(text));
        }
        function renderToolOutputBlocks(blocks, label, executionMeta = null) {
            const unwrappedPayload = unwrapSingleStructuredTextBlock(blocks);
            if (unwrappedPayload) {
                return `
                    <div class="formatted-block">
                        <div class="formatted-header">
                            <div class="formatted-title">${escapeHtml(label)}</div>
                            <div class="formatted-note">已识别为结构化结果，按字段语义展示</div>
                        </div>
                        <div class="structured-body">
                            ${renderToolExecutionMeta(executionMeta)}
                            ${renderSemanticPayload(unwrappedPayload.payload, {
                                label: unwrappedPayload.blockType,
                                extraFields: unwrappedPayload.extraFields
                            })}
                        </div>
                    </div>
                `;
            }
            const renderedBlocks = blocks.map((item, index) => {
                if (!isPlainObject(item)) {
                    return `
                        <div class="structured-array-item">
                            <div class="structured-array-label">第 ${index + 1} 项</div>
                            <div class="structured-array-body">${renderStructuredValue(item, 1)}</div>
                        </div>
                    `;
                }

                const parsedTextPayload = typeof item.text === 'string'
                    ? parseMaybeStructuredJson(item.text)
                    : null;
                const textBody = typeof item.text === 'string'
                    ? (isPlainObject(parsedTextPayload)
                        ? renderSemanticPayload(parsedTextPayload, {
                            label: typeof item.type === 'string' ? item.type : null,
                            extraFields: item
                        })
                        : renderMaybeStructuredText(item.text, 1))
                    : '';
                const extraFields = { ...item };
                delete extraFields.text;
                if (isPlainObject(parsedTextPayload) && typeof item.type === 'string') delete extraFields.type;
                const extraFieldEntries = Object.entries(extraFields);

                return `
                    <div class="structured-array-item">
                        <div class="structured-array-label">第 ${index + 1} 项${item.type ? ` · ${escapeHtml(item.type)}` : ''}</div>
                        <div class="structured-array-body">
                            ${textBody ? `
                                <div class="structured-subsection">
                                    <div class="structured-section-title">正文</div>
                                    ${textBody}
                                </div>
                            ` : ''}
                            ${extraFieldEntries.length ? `
                                <div class="structured-subsection">
                                    <div class="structured-section-title">附加字段</div>
                                    ${renderStructuredObject(extraFields, 1)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="formatted-block">
                    <div class="formatted-header">
                        <div class="formatted-title">${escapeHtml(label)}</div>
                        <div class="formatted-note">已按工具返回区块拆开展示</div>
                    </div>
                    <div class="structured-body">
                        ${renderToolExecutionMeta(executionMeta)}
                        <div class="structured-subsection">
                            <div class="structured-section-title">输出区块</div>
                            <div class="structured-array">${renderedBlocks}</div>
                        </div>
                    </div>
                </div>
            `;
        }
        function renderToolOutputContent(data, label, executionMeta = null) {
            return `
                <div class="formatted-block">
                    <div class="formatted-header">
                        <div class="formatted-title">${escapeHtml(label)}</div>
                        <div class="formatted-note">已识别为结构化结果，按字段语义展示</div>
                    </div>
                    <div class="structured-body">
                        ${renderToolExecutionMeta(executionMeta)}
                        ${renderSemanticPayload(data)}
                    </div>
                </div>
            `;
        }
        function renderPlainToolOutput(label, text, executionMeta = null, note = '已把工具返回文本展开为更易读的格式') {
            return `
                <div class="formatted-block">
                    <div class="formatted-header">
                        <div class="formatted-title">${escapeHtml(label)}</div>
                        <div class="formatted-note">${escapeHtml(note)}</div>
                    </div>
                    <div class="structured-body">
                        ${renderToolExecutionMeta(executionMeta)}
                        ${renderStructuredTextBlock(text)}
                    </div>
                </div>
            `;
        }
        function renderPrimaryContent(event, label, rawContent) {
            if (event.kind === 'tool_output') {
                const executionMeta = splitToolOutputEnvelope(rawContent);
                const toolBody = executionMeta ? executionMeta.body : rawContent;
                const parsedToolBody = parseMaybeStructuredJson(toolBody);
                if (isPlainObject(parsedToolBody)) {
                    return renderToolOutputContent(parsedToolBody, label, executionMeta);
                }
                if (Array.isArray(parsedToolBody)) {
                    return renderToolOutputBlocks(parsedToolBody, label, executionMeta);
                }

                const decodedToolBody = decodeEscapedText(toolBody);
                const reparsedToolBody = decodedToolBody !== toolBody ? parseMaybeStructuredJson(decodedToolBody) : null;
                if (isPlainObject(reparsedToolBody)) {
                    return renderToolOutputContent(reparsedToolBody, label, executionMeta);
                }
                if (Array.isArray(reparsedToolBody)) {
                    return renderToolOutputBlocks(reparsedToolBody, label, executionMeta);
                }
                return renderPlainToolOutput(label, decodedToolBody, executionMeta);
            }

            const parsed = tryParseJson(rawContent);
            const decoded = parsed === null ? decodeEscapedText(rawContent) : rawContent;
            const reparsed = parsed !== null ? parsed : (decoded !== rawContent ? tryParseJson(decoded) : null);
            const formatted = reparsed !== null ? JSON.stringify(reparsed, null, 2) : decoded;
            const note = reparsed !== null
                ? '已按 JSON 结构排版'
                : (formatted !== rawContent ? '已把转义换行展开为更易读的文本' : '保持原始文本排版');

            let html = `
                <div class="formatted-block">
                    <div class="formatted-header">
                        <div class="formatted-title">${escapeHtml(label)}</div>
                        <div class="formatted-note">${escapeHtml(note)}</div>
                    </div>
                    <pre>${escapeHtml(formatted)}</pre>
                </div>
            `;

            return html;
        }
        function closePanel() { document.getElementById("detailPanel").classList.remove("open"); }
        function toggleLabels() { showLabels = !showLabels; svg.selectAll(".node-label").style("display", showLabels ? "block" : "none"); }
        function escapeHtml(t) { if(!t) return ""; return String(t).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }
        window.addEventListener('resize', () => { width = main.node().clientWidth; height = main.node().clientHeight; });
        if (rootSessions.length > 0) switchRoot(rootSessions[0].session_id);
    </script>
</body>
</html>
"""

    # Escape sequences
    json_blob = json.dumps(root_sessions, ensure_ascii=False)
    json_blob = json_blob.replace("<", "\\u003c")

    html_content = html_template.replace("__ROOT_SESSIONS__", json_blob)
    path.write_text(html_content, encoding="utf-8")

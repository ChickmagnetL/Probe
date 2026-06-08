import type { DebugBasket, DebugBasketGroup, DebugBasketUnknownRoute } from "../../ipc/types";

export interface FieldInfo {
  label: string;
  placements: string[];
}

export interface DiagnosticItem {
  id: string;
  title: string;
  count: number;
  confirmationCount: number;
  fields: FieldInfo[];
  note?: string;
}

interface BasketSections {
  unparsed: DiagnosticItem[];
  hidden: DiagnosticItem[];
  visible: DiagnosticItem[];
  confirmationCount: number;
}

const ROUTE_LABELS: Record<string, string> = {
  session_meta: "会话信息",
  turn_context: "回合设置",
  "response_item.message": "消息内容",
  "response_item.reasoning": "思考内容",
  "event_msg.agent_reasoning": "思考内容",
  "response_item.function_call": "工具调用",
  "response_item.custom_tool_call": "自定义工具调用",
  "response_item.function_call_output": "工具输出",
  "response_item.custom_tool_call_output": "自定义工具输出",
  "event_msg.token_count": "用量统计",
  "event_msg.task_started": "任务开始",
  "event_msg.task_complete": "任务完成",
  "event_msg.turn_aborted": "回合中断",
  "event_msg.user_message": "用户消息",
  "event_msg.agent_message": "助手消息",
  "event_msg.exec_command_begin": "命令开始",
  "event_msg.exec_command_end": "命令结果",
  "event_msg.patch_apply_end": "文件修改结果",
  "event_msg.mcp_tool_call_end": "外部工具结果",
  "event_msg.view_image_tool_call": "查看图片",
  "response_item.image_generation_call": "图片生成",
  "event_msg.collab_agent_spawn_end": "子代理创建",
  "event_msg.collab_agent_interaction_end": "子代理交互",
  "event_msg.collab_waiting_end": "子代理等待",
  "event_msg.collab_close_end": "子代理关闭",
  "response_item.web_search_call": "网页搜索",
  "event_msg.web_search_begin": "网页搜索开始",
  "event_msg.web_search_end": "网页搜索结果",
  "event_msg.guardian_assessment": "安全审查",
  "event_msg.error": "错误",
  "event_msg.stream_error": "流错误",
  "event_msg.thread_rolled_back": "线程回滚",
  "event_msg.turn_diff": "回合变更",
  "event_msg.plan_update": "计划更新",
  "event_msg.thread_goal_updated": "目标更新",
  "event_msg.hook_started": "自动流程开始",
  "event_msg.hook_completed": "自动流程完成",
  "event_msg.context_compacted": "上下文压缩",
  compacted: "上下文压缩",
};

const GROUP_LABELS: Record<string, string> = {
  conversation_meta_raw: "会话信息",
  turn_manifest: "回合设置",
  message_items_raw: "消息内容",
  reasoning_items_raw: "思考内容",
  tool_calls_raw: "工具调用",
  tool_call_outputs_raw: "工具输出",
  telemetry_events: "用量统计",
  lifecycle_events: "任务状态",
  structured_tool_end_events: "工具结果",
  collaboration_events: "子代理协作",
  search_events: "网页搜索",
  system_events: "系统状态",
  compaction_events: "上下文压缩",
};

const FIELD_LABELS: Record<string, string> = {
  action: "执行动作",
  additional_details: "补充说明",
  agent_nickname: "代理名称",
  agent_path: "代理路径",
  agent_role: "代理角色",
  agent_statuses: "代理状态列表",
  aggregated_output: "汇总输出",
  arguments: "调用参数",
  base_instructions: "系统内置规则",
  call_id: "调用编号",
  changes: "文件改动",
  client_id: "客户端编号",
  cli_version: "命令行版本",
  code: "错误代码",
  collaboration_mode: "协作模式",
  collaboration_mode_kind: "协作模式",
  command: "命令内容",
  completed_at: "完成时间",
  compacted_token_count: "压缩后用量",
  content: "消息内容",
  cwd: "工作目录",
  decision_source: "判断来源",
  duration: "耗时",
  duration_ms: "耗时",
  dynamic_tools: "动态工具",
  encrypted_content: "加密内容",
  error_type: "错误类型",
  explanation: "说明",
  exit_code: "退出码",
  forked_from_id: "分支来源",
  formatted_output: "格式化输出",
  git: "Git 信息",
  goal: "目标",
  id: "编号",
  images: "图片",
  info: "用量详情",
  input: "输入内容",
  input_images: "输入图片",
  invocation: "外部工具调用",
  kind: "类别",
  last_agent_message: "最后一条助手消息",
  local_images: "本地图片",
  memory_citation: "记忆引用",
  memory_mode: "记忆模式",
  message: "消息",
  model: "模型",
  model_context_window: "上下文窗口",
  model_provider: "模型提供方",
  name: "名称",
  num_turns: "回滚回合数",
  original_token_count: "压缩前用量",
  originator: "发起方",
  output: "输出内容",
  output_images: "输出图片",
  parsed_cmd: "命令拆分结果",
  path: "图片路径",
  phase: "阶段",
  plan: "计划",
  prompt: "提示内容",
  query: "搜索词",
  rate_limits: "用量限制",
  rationale: "判断理由",
  reason: "原因",
  reasoning_effort: "思考强度",
  result: "结果",
  revised_prompt: "改写后的提示",
  risk_level: "风险等级",
  risk_score: "风险分",
  role: "角色",
  source: "来源信息",
  sources: "结果来源",
  started_at: "开始时间",
  status: "状态",
  stderr: "错误输出",
  stdout: "标准输出",
  summary: "摘要",
  target_item_id: "目标编号",
  text: "文本",
  text_elements: "文本元素",
  thread_source: "线程来源",
  timestamp: "时间",
  tool_name: "工具名称",
  truncation_policy: "截断策略",
  type: "内容类别",
  unified_diff: "文件差异",
  user_authorization: "用户授权",
};

// Placement labels describe exactly where the field is visible in the UI.
// "Graph"           = graph node label (truncated content)
// "Timeline"        = timeline card preview (truncated content)
// "Chat"            = conversation view message bubble
// "正文"            = detail overlay main content area (ContentRenderer)
// "Detail · 顶栏"   = detail overlay top cards (Role / Kind / Time / Phase)
// "Detail · 展开区"  = detail overlay expandable "Show Detail" section at the bottom
// "Sidebar"         = left session list
// Fields without an entry have no visible placement outside Raw and are
// listed as parsed-but-hidden.
const FIELD_PLACEMENTS: Record<string, Record<string, string>> = {
  session_meta: {
    id: "Sidebar",
    timestamp: "Sidebar",
  },
  turn_context: {},
  "response_item.message": {
    content: "Graph · Timeline · Chat · 正文",
    phase: "Detail · 顶栏",
    role: "Detail · 顶栏",
  },
  "response_item.reasoning": {},
  "event_msg.agent_reasoning": {},
  "response_item.function_call": {
    arguments: "正文",
    name: "Graph · 正文",
  },
  "response_item.custom_tool_call": {
    input: "正文",
    name: "Graph · 正文",
  },
  "response_item.function_call_output": {
    output: "正文",
  },
  "response_item.custom_tool_call_output": {
    output: "正文",
  },
  "event_msg.exec_command_begin": {
    command: "正文",
  },
  "event_msg.exec_command_end": {
    aggregated_output: "正文",
    command: "正文",
    exit_code: "正文",
    formatted_output: "正文",
    stderr: "正文",
    stdout: "正文",
  },
  "event_msg.patch_apply_end": {
    changes: "正文",
  },
  "event_msg.mcp_tool_call_end": {
    invocation: "正文",
    result: "正文",
  },
  "event_msg.view_image_tool_call": {
    path: "正文",
  },
  "response_item.image_generation_call": {
    result: "正文",
    revised_prompt: "正文",
  },
  "event_msg.collab_agent_spawn_end": {},
  "event_msg.collab_agent_interaction_end": {},
  "event_msg.collab_waiting_end": {},
  "event_msg.collab_close_end": {},
  "response_item.web_search_call": {
    query: "正文",
  },
  "event_msg.web_search_begin": {
    query: "正文",
  },
  "event_msg.web_search_end": {
    query: "正文",
    results: "正文",
    sources: "正文",
  },
  "event_msg.guardian_assessment": {
    action: "正文",
    rationale: "正文",
  },
  "event_msg.error": {
    additional_details: "正文",
    message: "正文",
  },
  "event_msg.stream_error": {
    additional_details: "正文",
    message: "正文",
  },
  "event_msg.thread_rolled_back": {
    num_turns: "正文",
  },
  "event_msg.turn_diff": {
    changes: "正文",
    unified_diff: "正文",
  },
  "event_msg.plan_update": {
    explanation: "正文",
    plan: "正文",
  },
  "event_msg.thread_goal_updated": {},
  "event_msg.context_compacted": {
    summary: "正文",
  },
  compacted: {
    summary: "正文",
  },
  "event_msg.token_count": {},
  "event_msg.task_started": {},
  "event_msg.task_complete": {},
  "event_msg.turn_aborted": {},
  "event_msg.user_message": {},
  "event_msg.agent_message": {},
  "event_msg.hook_started": {
    message: "正文",
  },
  "event_msg.hook_completed": {
    message: "正文",
  },
};

export function hasDebugBasketContent(basket: DebugBasket | null | undefined): boolean {
  return Boolean(
    basket
      && (
        basket.extracted_fields.length > 0
        || basket.residual_fields.length > 0
        || basket.unknown_routes.length > 0
      ),
  );
}

export function debugBasketBadgeCount(basket: DebugBasket | null | undefined): number {
  if (!basket) return 0;
  return buildBasketSections(basket).confirmationCount;
}

export function buildBasketSections(basket: DebugBasket): BasketSections {
  const unparsed = [
    ...basket.residual_fields.map(residualGroupToItem),
    ...basket.unknown_routes.map(unknownRouteToItem),
  ];
  const hidden: DiagnosticItem[] = [];
  const visible: DiagnosticItem[] = [];

  for (const group of basket.extracted_fields) {
    const hiddenKeys: string[] = [];
    const visibleKeys: string[] = [];
    for (const key of group.keys) {
      if (placementFor(group.route_key, key)) {
        visibleKeys.push(key);
      } else {
        hiddenKeys.push(key);
      }
    }
    if (hiddenKeys.length > 0) {
      hidden.push(parsedGroupToItem(group, hiddenKeys, false));
    }
    if (visibleKeys.length > 0) {
      visible.push(parsedGroupToItem(group, visibleKeys, true));
    }
  }

  return {
    unparsed,
    hidden,
    visible,
    confirmationCount:
      countConfirmations(unparsed) + countConfirmations(hidden),
  };
}

function residualGroupToItem(group: DebugBasketGroup): DiagnosticItem {
  return {
    id: `unparsed:${group.route_key}`,
    title: groupTitle(group),
    count: group.count,
    confirmationCount: group.count,
    fields: fieldLabels(group.keys),
  };
}

function unknownRouteToItem(route: DebugBasketUnknownRoute): DiagnosticItem {
  return {
    id: `unknown:${route.route_key}`,
    title: route.route_key,
    count: route.count,
    confirmationCount: route.count,
    fields: route.sources.map((s) => ({ label: formatSource(s), placements: ["Raw"] })),
    note: "应用暂时不知道这类内容应如何处理。",
  };
}

function parsedGroupToItem(
  group: DebugBasketGroup,
  keys: string[],
  includePlacement: boolean,
): DiagnosticItem {
  return {
    id: `${includePlacement ? "visible" : "hidden"}:${group.route_key}`,
    title: groupTitle(group),
    count: group.count,
    confirmationCount: includePlacement ? 0 : group.count,
    fields: fieldLabels(keys, group.route_key, includePlacement),
  };
}

function countConfirmations(items: DiagnosticItem[]): number {
  return items.reduce((sum, item) => sum + item.confirmationCount, 0);
}

function groupTitle(group: DebugBasketGroup): string {
  const label = ROUTE_LABELS[group.route_key] ?? GROUP_LABELS[group.table_name];
  return label ? `${label} (${group.route_key})` : group.route_key;
}

function fieldLabels(
  keys: string[],
  routeKey?: string,
  includePlacement = false,
): FieldInfo[] {
  const seen = new Set<string>();
  const result: FieldInfo[] = [];
  for (const key of keys) {
    const label = FIELD_LABELS[key];
    const display = label ? `${label} (${key})` : key;
    if (seen.has(display)) continue;
    seen.add(display);
    const placement = routeKey ? placementFor(routeKey, key) : null;
    const placements = includePlacement && placement
      ? [...new Set(placement.split(" · ").map(normalizePlacement)), "Raw"]
      : ["Raw"];
    result.push({ label: display, placements });
  }
  return result;
}

function normalizePlacement(p: string): string {
  if (p === "正文") return "Detail";
  if (p === "顶栏") return "Detail · 顶栏";
  if (p === "展开区") return "Detail · 展开区";
  return p;
}

function placementFor(routeKey: string, key: string): string | null {
  return FIELD_PLACEMENTS[routeKey]?.[key] ?? null;
}

function formatSource(source: string): string {
  const index = source.lastIndexOf(":");
  const rawPath = index >= 0 ? source.slice(0, index) : source;
  const line = index >= 0 ? source.slice(index + 1) : "";
  const fileName = rawPath.split(/[\\/]/).filter(Boolean).pop() ?? "导入文件";
  return line ? `${fileName} 第 ${line} 行` : fileName;
}

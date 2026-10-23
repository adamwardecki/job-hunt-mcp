// Shapes shared by the hook entry points (main.ts for Claude Code, hermes.ts for Hermes) and the gates.

export type ToolInput = Record<string, unknown>;

// The Claude Code hook payload fields the gates read. Hermes payloads are mapped onto this in hermes.ts.
export interface HookPayload {
  session_id?: string;
  transcript_path?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  prompt?: string;
  stop_hook_active?: boolean;
}

// What a gate prints: a PreToolUse/UserPromptSubmit decision, or a Stop block.
export interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'PreToolUse' | 'UserPromptSubmit';
    permissionDecision?: 'deny';
    permissionDecisionReason?: string;
    additionalContext?: string;
  };
  decision?: 'block';
  reason?: string;
}

export interface Approval {
  role_id: number;
  at: string;
  target_url: string;
  target_tab?: string;
}

export interface Denial {
  at: string;
  tool: string | undefined;
  reason: string;
}

export interface SessionState {
  marked: boolean;
  kind: string | null;
  approvals: Approval[];
  consents: Approval[];
  denials: Denial[];
  stop_blocks: number;
  pending_nudge?: string;
}

export interface UseStep {
  kind: 'use';
  id: string;
  name: string;
  input: ToolInput;
}

export interface ResultStep {
  kind: 'result';
  id: string;
  name: string;
  text: string;
  isError: boolean;
}

export type ToolStep = UseStep | ResultStep;

// The parsed JOBHUNT_TRIAGE_GUARD line printed by skills/triage-tracker/guard.js.
export interface GuardResult {
  ok?: unknown;
  problems?: string[];
}

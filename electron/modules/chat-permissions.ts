// What a `canUseTool` ask becomes on its way to the renderer, and what the
// renderer's answer becomes on its way back to the SDK.
//
// Pure, so the two rules that matter can be tested without Electron or a
// model turn:
//
//   - `suppressAlwaysAllowRule` — the rule "Always allow" would write grants
//     more than this ask's own action. The suggestions are not forwarded (so
//     the dialog has nothing to offer), the flag is (so it can say why not),
//     and an `always` answer that arrives anyway is downgraded to "allow once":
//     the renderer is not the only thing that has to get this right.
//   - `defaultToNo` and `mcpServer` are forwarded as the SDK wrote them; the
//     dialog decides what they look like.
import type { CanUseTool, PermissionResult, PermissionUpdate } from './chat-runner';
import type { PermissionDecision, PermissionRequest } from '../shared/chat-types';

type AskOptions = Parameters<CanUseTool>[2];

export function toPermissionRequest(
  requestId: string,
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  options: AskOptions
): PermissionRequest {
  const suppress = options.suppressAlwaysAllowRule === true;
  return {
    requestId,
    sessionId,
    toolName,
    title: options.title,
    displayName: options.displayName,
    description: options.description,
    input,
    suggestions: suppress ? undefined : options.suggestions,
    blockedPath: options.blockedPath,
    decisionReason: options.decisionReason,
    toolUseID: options.toolUseID,
    ...(suppress ? { suppressAlwaysAllowRule: true as const } : {}),
    ...(options.defaultToNo === true ? { defaultToNo: true as const } : {}),
    ...(options.mcpServer ? { mcpServer: options.mcpServer } : {}),
  };
}

export function toPermissionResult(
  d: PermissionDecision,
  options?: Pick<AskOptions, 'suppressAlwaysAllowRule'>
): NonNullable<PermissionResult> {
  if (d.kind === 'deny') return { behavior: 'deny', message: d.message || 'Denied by the user.' };
  if (d.kind === 'always' && options?.suppressAlwaysAllowRule !== true)
    return {
      behavior: 'allow',
      updatedInput: d.input,
      // The renderer round-trips the SDK's suggestions verbatim (opaque to it),
      // so the loose shared type narrows back to the SDK's here.
      updatedPermissions: d.suggestions as PermissionUpdate[] | undefined,
    };
  return { behavior: 'allow', updatedInput: d.input };
}

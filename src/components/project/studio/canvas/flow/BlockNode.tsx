// React Flow custom node. It reuses the existing `CanvasBlock` renderer verbatim
// — the same typed cards the hand-rolled canvas drew — so there is no second,
// diagram-only UI to maintain: Tailwind, the --cl-* theme tokens and the
// flowAtoms all apply unchanged. RF positions the wrapper; the block draws its
// own w×h box, so we render it inside a relative box and zero out its intrinsic
// x/y (the absolute-positioned BlockShell then simply fills the wrapper).

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CanvasBlock } from '../CanvasBlock';
import { useCanvasSelection } from './selection';
import type { BlockFlowNode } from './toFlow';

// Handles must exist for edges to attach, but connections aren't user-editable,
// so they're invisible and inert.
const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
};

function BlockNodeImpl({ data }: NodeProps<BlockFlowNode>) {
  const { block } = data;
  const sel = useCanvasSelection();

  return (
    <div style={{ position: 'relative', width: block.w, height: block.h }}>
      {/* Every side has an incoming and outgoing port. `toFlow` picks the pair
          from the nodes' live positions, so layout changes and manual dragging
          cannot leave an edge attached to the wrong side. */}
      <Handle
        id="tl"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="sl"
        type="source"
        position={Position.Left}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="tt"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="st"
        type="source"
        position={Position.Top}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <CanvasBlock
        block={{ ...block, x: 0, y: 0 }}
        active={sel.activeBlockId === block.id}
        selectedStep={sel.selectedStep}
        onSelectStep={sel.onSelectStep}
        onSelectBlock={sel.onSelectBlock}
        onHover={sel.onHover}
      />
      <Handle
        id="tr"
        type="target"
        position={Position.Right}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="sr"
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="sb"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
      <Handle
        id="tb"
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        style={HANDLE_STYLE}
      />
    </div>
  );
}

export const BlockNode = memo(BlockNodeImpl);

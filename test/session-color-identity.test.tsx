// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SessionBottomGlow,
  SessionColorFrame,
  SessionColorIdentity,
} from '../src/components/project/shared/SessionColorIdentity';

afterEach(cleanup);

describe('session colour inside Terminal / Lens', () => {
  it('keeps the session colour visible in the frame and its title', () => {
    const { container } = render(
      <SessionColorFrame color="blue">
        <SessionColorIdentity color="blue" title="Ship the release" />
        <SessionBottomGlow color="blue" active />
      </SessionColorFrame>
    );

    expect(container.firstElementChild?.className).toContain('cl-session-aura');
    expect(container.firstElementChild?.className).toContain('blue');
    expect(container.querySelector('.cl-session-aura-wash')).toBeNull();
    expect(container.querySelector('.cl-session-bottom-glow')).toBeTruthy();
    expect(container.querySelector('.cl-session-bottom-glow')?.className).toContain('is-active');
    expect(screen.getByRole('img', { name: 'Session colour blue' })).toBeTruthy();
    expect(screen.getByText('Ship the release').className).toContain('cl-session-identity');
    expect(screen.getByText('Ship the release').className).toContain('blue');
  });

  it('leaves an uncoloured session visually neutral', () => {
    const { container } = render(
      <SessionColorFrame>
        <SessionColorIdentity title="Plain session" />
        <SessionBottomGlow />
      </SessionColorFrame>
    );

    expect(container.firstElementChild?.className).not.toContain('cl-session-aura');
    expect(container.querySelector('.cl-session-bottom-glow')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Plain session')).toBeTruthy();
  });

  it('keeps a coloured glow mounted but inactive in Terminal', () => {
    const { container } = render(<SessionBottomGlow color="blue" active={false} />);

    expect(container.querySelector('.cl-session-bottom-glow')).toBeTruthy();
    expect(container.querySelector('.cl-session-bottom-glow')?.className).not.toContain(
      'is-active'
    );
  });
});

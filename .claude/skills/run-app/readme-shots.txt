# The ten screenshots of the README gallery, in the order the table shows them.
#
#   SCREENSHOT_DIR=docs/screenshots node .claude/skills/run-app/run.mjs \
#     .claude/skills/run-app/readme-shots.txt
#
# Shoot to a scratch directory first and look at the PNGs before copying them
# over the committed ones: a blank frame means the launch failed.
#
# `reset` before each view, because the skill editor hides the top bar and
# there is no way back from it. The two themes are shot from the same view —
# `theme` does not disturb navigation state.

launch

# ── Global Home ──
theme light
ss home_light
theme dark
ss home_dark

# ── Project Overview ──
reset
click-text webapp
theme light
ss project_light
theme dark
ss project_dark

# ── Skill editor ──
# The bundle page is the landing; the editor opens from the SKILL.md tile, and
# `Edit` is the frontmatter+body pane. The labels are title-case in the DOM and
# only uppercased by CSS, so match `Edit`, never `EDIT`.
reset
click-text Skills
click-text frontend-design
click-text SKILL.md
click-text Edit
theme light
ss skills_light
theme dark
ss skills_dark

# ── Agent View ──
reset
click-text Agent View
theme light
ss agentview_light
theme dark
ss agentview_dark

# ── Live Monitor ──
reset
click-text Monitor
theme light
ss monitor_light
theme dark
ss monitor_dark

quit

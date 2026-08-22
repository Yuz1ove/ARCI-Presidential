# StarryLink Next Design System

Status: Phase 0 contract

Applies to: Landing, Command Space, Field Link

Visual premise: **a calm operating environment that makes autonomous decisions legible**

This document defines the visual and interaction system for StarryLink Next. It is not a mood board and it does not authorize decorative complexity. Every visual element must help a person answer one of four questions:

1. What is happening now?
2. What did Starry Intelligence decide?
3. Was the action verified?
4. Can a human safely intervene?

## 1. Original design direction

The product draws principles—not shapes or components—from three references:

| Influence | Principle retained | StarryLink interpretation | What must not be copied |
| --- | --- | --- | --- |
| Linear | precise hierarchy, disciplined density, keyboard fluency | compact controls, quiet dividers, clear command states | layouts, iconography, navigation, or component styling |
| Siri | ambient intelligence, calm responsiveness, voice-adjacent presence | Starry Core as a spatial field whose behavior follows runtime state | Apple orb geometry, rainbow treatment, or branded motion |
| Mission Control | spatial causality and operational clarity | topology-first workspace with visible routes, fallbacks, and acknowledgements | radar clichés, military styling, or alarm-heavy visuals |

The synthesis must feel original: **restrained, dark, spatial, technically credible, and quietly cinematic**. It must never become cyberpunk, a generic AI SaaS dashboard, or a collection of glass cards.

## 2. Experience principles

### Intelligence is observable

Users see normalized observations, a short decision summary, selected policy, execution progress, verification, and adaptation. The interface never exposes hidden chain-of-thought. It exposes evidence.

### Topology is the primary object

The route through a changing network is more important than aggregate KPIs. Command Space gives the topology the largest continuous area and makes the active path unambiguous.

### Calm is a safety feature

Emergency states increase clarity and priority, not visual noise. No flashing red, shaking panels, urgent gradients, or simultaneous motion across the screen.

### State precedes animation

The runtime event causes a visible transition. Animation may explain the transition, but animation may never impersonate an agent decision.

### Evidence precedes confidence

Confidence is always paired with the evidence it summarizes: expected delivery, latency, observed packet loss, policy mode, or an acknowledgement. A percentage alone is not persuasive.

### One engine, two surfaces

Command Space and Field Link render the same mission, route, execution, and verification states. Field Link removes infrastructure decisions from the user; it does not replace them with a separate demo flow.

## 3. Foundations

### 3.1 Typography

Use no more than two type families:

- **Inter Variable** (OFL) for interface, headings, and body text. The platform system sans stack is the no-download fallback.
- **IBM Plex Mono** (OFL) only for telemetry, timestamps, route identifiers, and tabular values.

Typography remains useful if web fonts fail. Numerals in telemetry must use `font-variant-numeric: tabular-nums`.

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `type.display` | `clamp(2.75rem, 6vw, 5.5rem)` / 0.96 | 520 | landing statement only |
| `type.title` | `clamp(1.75rem, 3vw, 2.75rem)` / 1.06 | 520 | primary screen title |
| `type.heading` | 20px / 28px | 560 | section title |
| `type.subheading` | 15px / 22px | 560 | grouped content title |
| `type.body` | 15px / 23px | 420 | default reading text |
| `type.body-small` | 13px / 19px | 430 | supporting detail |
| `type.label` | 11px / 16px, `0.08em` tracking | 600 | short uppercase labels |
| `type.telemetry` | 12px / 18px | 450 | values, IDs, timestamps |
| `type.telemetry-large` | 24px / 30px | 480 | one emphasized live value |

Rules:

- Headings use tight tracking (`-0.02em` to `-0.035em`), never oversized heavy display type.
- Body lines are 45–65 characters where reading, not scanning, is required.
- Labels are sentence case by default. Uppercase is reserved for compact operational labels such as `ACTIVE ROUTE`.
- Status copy is terse and literal: “Route degraded. Adapting.”, “Fallback confirmed.”, “Delivery verified.”
- Never use a futuristic display face, rounded novelty face, or faux-terminal typography for normal copy.

### 3.2 Color

Color conveys state only when paired with text, icon shape, or line treatment. No blue-purple page gradient is permitted.

#### Neutral and surface tokens

| Token | Value | Purpose |
| --- | --- | --- |
| `color.canvas` | `#07090D` | root background |
| `color.canvas-raised` | `#0A0D12` | navigation or anchored rail |
| `color.surface-subtle` | `#0E1219` | grouped controls and selected rows |
| `color.surface-strong` | `#131925` | overlays and high-emphasis regions |
| `color.border-subtle` | `#202733` | separators and topology guides |
| `color.border-strong` | `#3A4557` | focus-adjacent structural border |
| `color.text-primary` | `#F3F5F7` | primary copy |
| `color.text-secondary` | `#ADB6C4` | supporting copy |
| `color.text-muted` | `#7F8999` | tertiary labels; never critical text |

#### Semantic tokens

| Token | Value | Meaning |
| --- | --- | --- |
| `color.intelligence` | `#A9D8F4` | agent activity and selected reasoning context |
| `color.route-active` | `#C4EEF2` | active, currently executing route |
| `color.verified` | `#8FD9B6` | acknowledgement or verified success |
| `color.attention` | `#E9C67A` | uncertain, pending, or degraded state |
| `color.critical` | `#FF9A91` | emergency priority or hard failure |
| `color.manual` | `#C8B6E8` | human override state |
| `color.unavailable` | `#596272` | disabled or unreachable infrastructure |

All final foreground/background pairs must be tested. Normal text targets WCAG 2.2 AA contrast of 4.5:1; large text and meaningful non-text boundaries target 3:1. `text-muted` is not valid for essential instructions, control names, route state, or emergency information.

### 3.3 Spacing, sizing, and shape

Use a 4px base grid.

| Token | Value | Common use |
| --- | --- | --- |
| `space.1` | 4px | micro-gap |
| `space.2` | 8px | icon-to-label |
| `space.3` | 12px | compact row |
| `space.4` | 16px | default component padding |
| `space.5` | 20px | grouped content |
| `space.6` | 24px | panel padding |
| `space.8` | 32px | section gap |
| `space.10` | 40px | major separation |
| `space.12` | 48px | page rhythm |
| `space.16` | 64px | landing composition |

Shape tokens are deliberately restrained:

- `radius.control`: 6px
- `radius.surface`: 10px
- `radius.overlay`: 14px
- `radius.round`: 999px, only for true circular controls, compact status dots, and progress tracks

Do not increase radius to make a weak hierarchy feel friendly. Prefer spacing, alignment, typography, and a single divider before adding borders or containers.

Minimum interactive target size is 44 × 44px on touch surfaces and 32 × 32px on pointer-first surfaces, while keyboard focus remains visible in both.

### 3.4 Borders, depth, and lighting

Depth order:

1. spacing and grouping;
2. a 1px divider;
3. a subtle surface shift;
4. a border;
5. a shadow only for an object that physically overlays another object.

Use `border-subtle` for most divisions. Selected or focused regions may use `border-strong`. Avoid card outlines around every region.

Shadows are neutral and soft; they do not glow. Luminous effects belong only to Starry Core and active route energy. Keep them spatially bounded so they do not wash out text or imply clickability.

## 4. Spatial layout

### 4.1 Landing

The first viewport is a product entrance, not a dashboard:

- Wordmark and minimal navigation at the top.
- Narrative statement anchored left or lower-left: “Networks fail. Communication shouldn’t.”
- Starry Core occupies the visual center without becoming a fixed sphere.
- Three small telemetry readings—network state, active route, confidence—sit on a shared baseline rather than three cards.
- `Enter System` is the only primary action.

The opening sequence may reveal distant nodes, lose connections, introduce Starry Core, and restore a route. It must be skippable, finish in 5–7 seconds, and collapse to a static final composition under reduced motion.

### 4.2 Command Space

At 1440 × 900, use an edge-to-edge operational grid:

| Region | Nominal size | Content |
| --- | --- | --- |
| Command bar | 56px high | product, mode, autonomy, simulation status, override |
| Mission rail | 240–256px | mission context, priority, device, battery |
| Topology field | remaining width, minimum 560px | live nodes, active route, route transition |
| Intelligence rail | 304–328px | phase, decision summary, confidence and evidence |
| Timeline | 176–208px high | ordered runtime events and verification |

The rails use page-level divisions, not floating cards. The topology remains visually continuous behind sparse labels. Timeline rows share one grouped surface with lightweight separators.

At 1280 × 800, rails compress to 216px and 288px, secondary labels shorten, and the timeline can collapse to 160px. Nothing may overlap the active route.

At 1024px and below, the Intelligence rail becomes a toggleable inspector and the Mission rail becomes a compact header. Command Space does not simply shrink into the mobile product.

### 4.3 Field Link

At 390 × 844, Field Link is a separate task-specific composition:

- Top: connection and battery state in plain language.
- Middle: four large actions—`Need Help`, `Medical`, `Can't Call`, `I'm Safe`.
- Bottom: the current delivery state and a single manual detail disclosure.

There is no infrastructure picker. A person never needs to choose 5G, LoRa, drone relay, or satellite. Route detail appears only after the primary task has been secured and must never block the action.

## 5. Starry Core

Starry Core is the ambient representation of Starry Intelligence. It is not a mascot, chat bubble, glowing logo, or Apple-like orb.

### 5.1 Construction

The visual is an irregular, soft-edged field built from no more than three perceptual layers:

1. a low-contrast spatial veil;
2. restrained filaments or particles whose direction reflects routing activity;
3. a small high-luminance locus that indicates current computational focus.

The field must retain an irregular silhouette and low saturation. It may occupy 120–220px on Landing, 72–112px in Command Space, and 40–56px as a compact Field Link indicator.

### 5.2 State behavior

| Runtime state | Visual behavior | Persistent text equivalent |
| --- | --- | --- |
| `idle` | 6–8s low-amplitude breath | Ready |
| `observing` | sparse inward traces every 1.5–2s | Observing network |
| `understanding` | localized convergence with steady boundary | Assessing risk and constraints |
| `planning` | 2–4 candidate filaments briefly branch | Evaluating routes |
| `acting` | one directional stream aligns to selected topology path | Establishing route |
| `verifying` | motion decelerates into two restrained acknowledgement beats | Verifying delivery |
| `verified` | brief stable expansion, then idle | Delivery verified |
| `emergency` | faster cadence and higher contrast, not flashing | Critical mission active |
| `degraded` | uneven cadence plus amber boundary marker | Degraded mode · deterministic policy |
| `manual` | field becomes steady; manual marker remains visible | Manual override active |

State transitions come from runtime events. The component must not run a looping fake state sequence.

### 5.3 Accessibility and fallback

- Starry Core is decorative to assistive technology unless it is the only carrier of state; the adjacent text is the canonical status.
- Reduced motion removes particles, flow, and scale changes. State changes use a 150ms opacity crossfade or update instantly.
- Low graphics quality uses a precomputed gradient field with no continuous particle simulation.
- If rendering fails, a static contour plus the current state label preserves meaning.

## 6. Dynamic topology

Topology is a semantic map of communication options, not an abstract node graph.

### 6.1 Visual grammar

- Device or originating node anchors the composition.
- Destinations and relay layers follow a stable spatial order so routes can be compared over time.
- Node shape plus label identifies category; color is secondary.
- Active route: high-contrast solid path with direction and route label.
- Candidate route: low-contrast solid path, visible only during planning or detail inspection.
- Fallback route: quiet dashed path with fallback ordinal.
- Failed path: decays to a thin interrupted trace and receives a failure marker; it does not disappear before the timeline records why.
- Unavailable node: muted fill, explicit `Unavailable` label, and non-color shape treatment.
- Packet marker: a small directional trace used only while an actual execution is pending.

Active, candidate, fallback, failed, and unavailable states must be distinguishable in monochrome.

### 6.2 Route transitions

A visible route switch follows this order:

1. old route receives `degraded` or `failed` treatment;
2. candidate routes appear only while the runtime is planning;
3. the policy-approved route becomes selected;
4. packet movement begins after the execution event;
5. the path becomes verified only after correlated ACK;
6. the old route remains as quiet historical context until the next stable observation window.

The UI must never switch a path because a scenario button directly changed presentation state.

### 6.3 Rendering choice

- Prefer SVG up to 30 visible nodes: best semantics, accessibility, and deterministic testing.
- Consider Canvas for 31–250 frequently changing nodes, with a parallel accessible data representation.
- Use WebGL only after profiling proves Canvas insufficient for a real node count. Three.js is not a default dependency.

Labels and interactions remain DOM-based when the graph is Canvas or WebGL. Decorative particles pause when the page is hidden.

## 7. Operational components and states

### 7.1 Mission context

Use a compact definition list, not KPI cards. Priority has both word and icon. Battery includes percentage and estimated runtime when available. The mission type is the primary item.

### 7.2 Starry Intelligence rail

This is an event and decision inspector, never a conversation transcript. Default order:

1. current loop phase;
2. most recent decision summary;
3. reason codes in human language;
4. confidence and expected outcome;
5. policy mode and expandable evidence.

Never present a text input or assistant avatar.

### 7.3 Intelligence Timeline

Every entry uses a timestamp, event verb, object, and result. Group related events by a shared cycle identifier. ACK entries include route and latency. Errors state the next bounded action.

### 7.4 State vocabulary

| State | Required treatment | Example copy |
| --- | --- | --- |
| Nominal | quiet verified indicator | 5G route verified |
| Observing | neutral activity marker | Observing network |
| Planning | intelligence accent and candidate count | Evaluating 4 routes |
| Executing | active path and progress | Establishing LoRa relay |
| Verifying | pending acknowledgement treatment | Awaiting acknowledgement |
| Recovered | verified treatment plus prior route context | Fallback confirmed |
| Degraded | amber shape marker and policy label | Deterministic policy active |
| Critical | critical icon, label, and priority order | Medical emergency · Critical |
| Offline/queued | explicit durable queue state | Stored on device · Will retry |
| Manual override | persistent manual marker | Manual route control active |
| Failed | interrupted line, reason, and next action | No ACK · Replanning |

Empty, loading, permission-denied, unknown, and stale-data states are required. “Unknown” must never be displayed as “Unavailable.” Stale observations include age.

## 8. Motion

### 8.1 Tokens

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `motion.instant` | 0–80ms | linear | pressed and immediate state feedback |
| `motion.fast` | 120ms | ease-out | focus, hover, small disclosure |
| `motion.standard` | 220ms | cubic-bezier(.2,.8,.2,1) | panel and state transition |
| `motion.route` | 420ms | cubic-bezier(.16,1,.3,1) | topology route emphasis |
| `motion.settle` | 700ms | cubic-bezier(.22,1,.36,1) | verified state settling |

No critical state waits for an animation to complete. Continuous motion is limited to Starry Core during active phases and active packet movement during execution.

### 8.2 Reduced motion

When `prefers-reduced-motion: reduce` is active:

- skip the landing sequence and show its final state;
- stop orbital, particle, waveform, route-dash, and parallax motion;
- replace route morphs with immediate geometry and a 150ms opacity change;
- preserve event ordering, focus movement, labels, and acknowledgement state;
- never use auto-scrolling timeline behavior.

## 9. Interaction, accessibility, and emergency ergonomics

- Meet WCAG 2.2 AA for the target prototype.
- Use semantic landmarks, headings, lists, buttons, and definition lists before ARIA.
- Keyboard order follows visual reading order. All scenario controls, timeline entries, topology nodes, details, autonomous mode, and manual override are reachable.
- Focus uses a 2px `route-active` outline with at least 2px offset; focus is never represented by glow alone.
- Live runtime updates use a throttled polite live region. Medical delivery failure and manual-control transfer may use assertive announcement once, never repeatedly.
- Screen-reader summaries state route changes as cause → action → result, for example: “Cellular route degraded. LoRa relay selected. Acknowledgement received in 1.8 seconds.”
- Status never relies on color, motion, direction, sound, or spatial position alone.
- Escape closes non-destructive overlays. Manual override requires a labeled confirmation, describes consequences, and preserves keyboard focus.
- Field Link keeps primary actions in the reachable lower two-thirds and works at 200% text zoom without clipping or hiding delivery state.
- Touch interactions do not depend on hover or precision dragging.

## 10. Performance and graphics quality

The visual system has an operational performance budget:

| Budget | Target |
| --- | --- |
| Route state visible after engine event | ≤100ms |
| Interaction response | ≤100ms |
| Animation frame rate | 60fps target; no sustained drop below 50fps on reference hardware |
| Main-thread frame work during motion | ≤8ms typical, never a sustained full 16.7ms frame |
| Long task | none over 50ms during the golden path |
| Initial critical UI JavaScript | target ≤200KB gzip before visualization libraries |
| Hidden-tab graphics | paused |

Graphics quality adapts without changing domain state:

| Mode | Starry Core | Topology | Effects |
| --- | --- | --- | --- |
| High | ≤160 particles at 1× DPR simulation | smooth route interpolation | one bounded blur layer |
| Medium | ≤80 particles | reduced interpolation samples | lower-resolution field |
| Low | ≤24 particles or CSS gradient field | direct path updates | no blur/backdrop filter |
| Reduced motion | static contour | instant paths | no particles or continuous effects |

Quality may step down after 30 consecutive frames below 50fps, a low-power hint, or battery saver signal. It must not step up again during an active emergency. Graphics mode is observable in diagnostics but does not appear as a user task.

## 11. Responsive and failure behavior

- The desktop topology always retains a minimum useful plot area; inspectors collapse before the plot does.
- At mobile widths, Field Link is the canonical user surface. A responsive Command Space may provide read-only status but is not the emergency action experience.
- Loss of network does not blank the screen. The last observation is marked stale, queued missions remain visible, and local policy mode is explicit.
- A failed Starry Core or topology renderer cannot block mission creation, manual override, or delivery status.
- Text, route labels, and verification evidence render before decorative graphics.

## 12. Anti-pattern checklist

A review fails if any checked item is present:

- [ ] The first screen is a dashboard grid or feature inventory.
- [ ] Most information lives in independent rounded cards.
- [ ] Starry Intelligence is represented as a chatbot, prompt box, or assistant avatar.
- [ ] The UI asks a field user to choose 5G, Wi-Fi, LoRa, drone, or satellite.
- [ ] A blue-purple gradient, neon palette, faux-terminal type, or cyberpunk motif dominates.
- [ ] Glassmorphism, blur, glow, or shadow is used as the primary hierarchy system.
- [ ] Large KPI tiles displace topology or evidence.
- [ ] Route changes are hard-coded to scenario buttons or timed animation.
- [ ] Confidence appears without evidence, policy mode, or uncertainty handling.
- [ ] Emergency, degraded, or verified state depends on color or motion alone.
- [ ] Failure disappears without reason, retry, fallback, or manual-control path.
- [ ] Starry Core copies Siri’s orb silhouette or rainbow language.
- [ ] Continuous decorative animation consumes resources while hidden or in low-power mode.
- [ ] Reduced motion removes information instead of replacing motion with static state.
- [ ] Desktop Command Space is merely squeezed into the mobile interface.
- [ ] Copy uses vague claims such as “AI-powered revolutionary platform.”
- [ ] Default Tailwind component styling is recognizable in the final composition.

## 13. Prototype acceptance rubric

Score each criterion `0` (absent/incorrect), `1` (present but weak), or `2` (clear and production-directed).

| Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Originality | copied or generic dashboard | mixed original/template language | original restrained synthesis |
| Hierarchy | cards/KPIs dominate | topology competes with panels | route and mission are immediately legible |
| Agent causality | decorative AI activity | partial phase visibility | Observe → Understand → Plan → Act → Verify → Adapt is evidenced |
| Route transition | direct UI swap | switch shown without full evidence | degradation, candidate, execution, ACK, and history are visible |
| Starry Core | orb/chatbot/decorative loop | stateful but ambiguous | runtime-driven and text-equivalent |
| Failure awareness | optimistic-only | generic error | confidence, degraded policy, fallback, and override are explicit |
| Field Link | infrastructure-heavy | actions present but secondary | four actions dominate and routing is automatic |
| Accessibility | color/motion dependent | partial keyboard/contrast support | WCAG AA target, full keyboard, labels, reduced motion |
| Performance | visible jank or unbounded effects | acceptable on desktop only | budgets met across quality modes |
| Responsive quality | clipping or shrunken desktop | usable but compromised | desktop/laptop/mobile compositions are intentional |
| Copy quality | promotional or verbose | mostly direct | terse, specific, operational |
| Evidence density | metrics as decoration | evidence available in details | decision, policy, execution, and verification read in one scan |

Acceptance requires:

- at least **20/24**;
- a score of `2` for Agent causality, Route transition, Accessibility, and Failure awareness;
- no anti-pattern checklist item checked;
- successful visual review at 1440 × 900, 1280 × 800, and 390 × 844;
- reduced-motion and Low graphics mode verified through the same scenario path;
- no visible route state that cannot be traced to a runtime event.

This rubric evaluates the prototype as an AI operating environment, not as a static screenshot. A beautiful frame that cannot prove action and verification does not pass.

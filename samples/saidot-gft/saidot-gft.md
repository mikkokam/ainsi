---
theme: saidot-web
logo: assets/saidot-wordmark.svg
coverLogo: assets/saidot-mark.png
---

<!-- ainsi: prose size=small caps color=accent -->
<!-- ainsi: layout default tone=inverse -->
Governance and enforcement

# The systems being governed are in flux

<!-- ainsi: boxes stretch -->
1. **Models** Swapped for a newer version, a cheaper provider or a fine-tune, and every system built on the old one inherits the change.
2. **Platforms, systems & agents** Built on Foundry, Bedrock, Google or in-house orchestration, acting on business systems through tools, replaced in weeks.
3. **AI inside the tools already in use** Copilots in productivity suites, assistants inside SaaS, GenAI in the delivery pipeline.
Adopted faster than any review cycle, often without anyone registering them.

<!-- ainsi: prose size=small color=soft -->
*Three clouds, four agent platforms, a hundred systems? The **decisions** about them cannot live in a single platform.*

---

<!-- ainsi: layout split side=right size=half -->

# Three lines, one record

*The model is not new.* What is new is what sits in the first line: a platform that enforces its own controls and reports on itself.

The second line needs its own record. The first line emits the evidence. It does not hold the register, set the tier, or decide when a control is satisfied.

The third line tests that record against what actually ran, sampling the runtime directly. Neither internal audit nor an external assessor should have to ask the teams under audit to assemble their own evidence.

<!-- ainsi: prose size=small color=soft -->
ISO/IEC 42001 asks for internal audit and management review.
The EU AI Act asks high-risk providers for a conformity assessment, in most cases their own, and the technical documentation behind it. Both assume the record exists.

<!-- ainsi: full size=m align=right -->
![Three stacked bands. Independent assurance, third line and external: internal audit, and external assurance for certification and notified bodies. Second line, governance: AI risk and compliance, and the record. First line, build and run: builders and platform teams, and enforcement in each runtime. The tier and the control set travel down, evidence comes up, the record goes to assurance, and assurance samples the runtime directly.](assets/three-lines.png)

---

<!-- ainsi: layout split side=right size=two-thirds -->

<!-- ainsi: prose size=small -->
# Governance is a separate role

<!-- ainsi: prose size=small -->
*The decisions are the organisation's: which frameworks apply, the risk appetite, the tier of each system, the controls it must satisfy, who is accountable. They have to survive a platform swap - or systems covering many - so they live above all of the platforms, in one place.*

<!-- ainsi: prose size=small -->
A runtime enforces what it runs and reports on itself. Oversight of that enforcement is a different accountability. The first line cannot be its own second.

<!-- ainsi: prose size=small -->
The platform knows who ran a workflow. It does not know the system's purpose, its tier or its owner. Risk is contextual, so that is decided where the use case is.

<!-- ainsi: full size=l align=right -->
![Governance above, holding decisions and oversight. Below it three runtimes, each enforcing its own: the agent platform, copilots and SaaS AI, build and deployment. The tier and the control set travel down, evidence and named gaps come back up.](assets/governance-role.png)

---

# Enforcement stays in the runtime

<!-- ainsi: prose size=small -->
Enforcement on platforms: largely solved; and the hot path is where it belongs.
What is missing sits at both ends: a control authored once, and the event that proves it held.

<!-- ainsi: full size=l -->
![One control read left to right. Authored once in governance, as prose for the person and structured fields for the machine. Enforced by you, in your policy engines, platform gates and model gateways. Proven back in governance, as the event attached to the control on the system it belongs to.](assets/enforcement-interface.png)

<!-- ainsi: prose size=small color=soft -->
Current: Your team writes the rule, as it does today. No new component sits between your agents and your models.
Planned: Working to automate or help creating rules.

---

# How a decision travels

<!-- ainsi: timeline -->
1. **Register** Systems, models, agents, datasets and tools land in one graph, by hand, by connector, or by an agent over MCP.
2. **Classify** Rules read the metadata, region, use, linked components, and set the tier. A person ratifies it.
3. **Map** The tier and the linked risks resolve the control set through the graph. Each control is itemised, carrying its scope, its recurrence, the evidence it requires and its links, all readable over the API.
4. **Assign** Each control gets an owner and a due date. Lifecycle stages gate on approval, and a review goes to a named reviewer, internal or external.
5. **Evidence** Observability events come back from the runtime and attach to the control. An event can open an incident, a review or a reclassification.
6. **Report** Reviews and transparency reports are generated from the record, current on the day they are asked for.

<!-- ainsi: prose size=small color=soft -->
Registering, classifying and mapping run through the MCP servers as well, so a client's own agents can operate the loop.

---

<!-- ainsi:layout default tone=soft -->

# Your governance model, configured

<!-- ainsi: agenda -->
1. **Your controls, as entities** Your own controls sit in the graph beside the **110+** policies in the library, linked to systems, risks and evidence like anything else.
Not documents attached to a record. Authoring your own policy frameworks is in preview.
2. **Your process, as roles and tasks** Roles are assigned per system: owner, compliance specialist, reviewer, oversight manager.
Lifecycle stages, approval gates and review cadence are set per organisation. Modelling the wider process as tasks is in development.
3. **Your automation, at your pace** Every rule is a workflow you switch on: classification, inheritance, control assignment, lifecycle approvals.
What is not automated stays a task for a person.

---

<!-- ainsi:layout default tone=accent -->

# Governance stays a gate. It stops being a queue.

<!-- ainsi: columns -->
- **Rules-based tiering** Properties decide the tier. A person ratifies it, because that one property scopes every obligation downstream.
- **Rules-based control profiles** The tier resolves its own control set. Nobody maps controls per system.
- **Lifecycle approvals** A stage transition gates on approval, and reviews go to the role that owns them, when due.
- **Event-based triggers** Drift, an incident or a change reopens the assessment. Production keeps the record current.

<!-- ainsi: prose size=small color=soft -->
*Where this goes: the same loop at the scale of the whole AI estate of an organisation - with more of it automated and a person still deciding.*

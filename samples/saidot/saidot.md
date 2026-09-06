---
theme: saidot-web
logo: assets/saidot-wordmark.svg
coverLogo: assets/saidot-mark.png
---

<!-- ainsi:layout header -->

# Saidot

## Govern AI systems, models and agents in one connected graph

Company presentation

September 2026

---

<!-- ainsi: prose size=small caps color=accent -->
Who this is for

# You are accountable for AI you did not build and cannot see

<!-- ainsi: boxes stretch -->
1. **Legal and compliance** The EU AI Act, ISO/IEC 42001 and NIST AI RMF each ask for an inventory, a classification and evidence. Each is answered by hand, separately, and again when the next jurisdiction arrives.
2. **Risk and governance leads** Models, agents, datasets and suppliers live in different spreadsheets. Nobody can say which model powers which product, or what changes when one is swapped.
3. **AI and business leadership** The mandate is to ship faster. Governance meets the teams as a queue, so they route around it, and the inventory is stale the day it is signed.

---

<!-- ainsi:layout split side=right -->

# The thing being governed changed shape

Three years ago the unit was a model behind an API. Now it is an agent: a model, a purpose, a set of tools and the business systems it acts on.

Agents are built on platforms, arrive through open interfaces such as MCP, and are replaced in weeks. A control plane governs what it runs. Everything else is outside it.

Speed is the problem. A review cycle measured in quarters cannot govern a fleet that changes weekly.

<!-- ainsi: full size=full -->
![Picture to add: the AI landscape, from models to agents to platforms, with the pace of change]()

---

<!-- ainsi:layout section -->

# What AI governance is

Decide. Convey. React.

---

# Governance is three verbs

<!-- ainsi: columns -->
1. **Decide** What is the risk posture. Which tier does a system fall in, which controls apply to it, who is answerable for it, what evidence proves the control is in place.
2. **Convey** Carry those decisions to the people and the machines that enforce them. A control nobody downstream can read is a document, not a control.
3. **React** A model swap, an incident, a new obligation or drift in production reopens the decision. Either the decision changes or the system is brought back into line.

<!-- ainsi: prose size=small color=soft -->
Risk is contextual. The same model is low risk in a drafting assistant and high risk in a hiring pipeline. Classification happens where the use case is, not where the code runs.

---

<!-- ainsi:layout split -->

# Why governance and enforcement are two layers

Enforcement acts at the moment of action: allow, block, escalate. It lives in the runtime, it must be fast, and each platform has its own.

Governance decides what enforcement should do, and it has to see every system, including those on platforms with no enforcement at all.

Merge the two and you get a runtime that governs only what it runs, and a governance function with no way to reach the rest.

Governance sets the rule. Enforcement applies it. Evidence flows back.

<!-- ainsi: full size=full -->
![Diagram to add: governance plane above, runtime control plane below, controls as code flowing down, events as evidence flowing up]()

---

<!-- ainsi:layout default tone=soft -->

# The same shape as the rest of governance

<!-- ainsi: columns -->
- **Information security** ISO 27001 decides controls, the infrastructure enforces them, audits collect evidence. AI governance is the same loop with a different set of assets and obligations.
- **Privacy** A DPIA is a decision about a system. A high-risk AI Act classification is the same kind of decision about the same system, often on the same data.
- **One control, many frameworks** Logging AI decisions for six months satisfies an AI Act obligation and an ISO 27001 control at once. Evidence collected once should count everywhere.

<!-- ainsi: prose size=small color=soft -->
AI governance sits beside enterprise GRC, not inside it. The joins are people today: documents sent across, someone on the other side interpreting them.

---

<!-- ainsi:layout section -->

# Saidot

The system of record for AI governance.

---

<!-- ainsi:layout split side=right -->

# One graph, one library

Systems, models, agents, tools, datasets, risks, policies, controls, evidence and incidents, connected. Govern once and the decision reaches everything linked to it: a control set on a model reaches every system using it, a risk on a dataset reaches every agent reading from it.

Nobody starts from a blank page. The library is curated and versioned by Saidot's governance experts and covers the EU AI Act, ISO/IEC 42001, NIST AI RMF and 110+ policies.

<!-- ainsi: figures -->
- **260+** risks
- **620+** controls
- **110+** policies
- **170+** third-party models

---

# Three ways governance gets done

<!-- ainsi: boxes stretch -->
1. **Workflows** Rules do the routine. AI Act classification runs when a system is registered or edited. Risks and risk levels are inherited from linked models, datasets and products. Controls are assigned to every system whose properties match. Lifecycle stages gate on approval.
2. **Tasks** The human process, modelled. Reviews, approvals and sign-offs are raised for the right role when they are due, so accountability is a queue of named work rather than a policy document. In development.
3. **Agents** Three MCP servers, Governance, Library and Docs, put the platform in front of any AI assistant. An agent registers a system from the deployment it sees, drafts the assessment, attaches evidence and opens the approval. 95% of the platform is operable through the REST API.

---

<!-- ainsi:layout split -->

# Evidence comes back from production

Runtime observability events are ingested from the AI stack: Azure AI Foundry, Amazon Bedrock, or anything over the API. An event can open an incident, trigger a review or change the risk level on an agent, a model or a system.

Notifications route to Slack and Jira. Evaluations are generated per system: regular testing and red teaming plans, run in the runtime, results fed back to the record.

The loop closes without a person carrying a document across.

<!-- ainsi: full size=full -->
![Diagram to add: the loop, decide and compile above, enforce and attest below, with the observability API as the return path]()

---

<!-- ainsi:layout default tone=soft -->

# Governance stays a gate. It stops being a queue.

<!-- ainsi: columns -->
- **Rules-based tiering** Properties decide the tier. A person ratifies it, because that one property scopes every obligation downstream.
- **Rules-based control profiles** The tier resolves its own control set through the graph. No one maps controls per system.
- **Lifecycle tasks** Reviews, approvals and sign-offs are raised when due, to the role that owns them.
- **Event-based triggers** Drift, an incident or a change reopens the assessment. The record is current because production keeps it current.

---

<!-- ainsi:layout section -->

# Roadmap

From a system of record to the link into enforcement.

---

# Controls as code, compiled per runtime

<!-- ainsi: columns -->
1. **Authored once** A control carries its prose for the person and its parameters for the machine: log AI decisions, retain six months, tamper-evident. Applies when the tier is high. Also satisfies ISO 27001 A.8.15.
2. **Compiled per runtime** The same control becomes a policy for each runtime's own engine. Saidot enables enforcement and does not sit in the hot path.
3. **Attested or named as a gap** A runtime reports that the control is in place, or that it cannot check it. An unknown stays a gap until something answers. Never a silent pass.

<!-- ainsi: prose size=small color=soft -->
Properties get a source and a trust level: system of record, integration, human declaration, unknown. OSCAL as the exchange format, so auditors and other tools read the same catalogue.

---

<!-- ainsi:layout default tone=accent -->

# Shipped, in development, proposed

<!-- ainsi: boxes stretch -->
- **Shipped** Graph, library and inventory. Workflow automation for classification, inheritance, control assignment and lifecycle approvals. Governance, Library and Docs MCP servers. REST API. Observability API and evaluations for Azure AI Foundry and Amazon Bedrock.
- **In development** Tasks: the human process modelled as named work by role. Orchestrator MCP. Lifecycles, roles, thresholds and templates customised per organisation.
- **Proposed** Properties with source and trust. Applicability rules per system. Controls compiled per runtime with capability negotiation. OSCAL import and export.

---

<!-- ainsi:layout header -->

# Govern once. Inherit everywhere. Prove it from production.

saidot.ai

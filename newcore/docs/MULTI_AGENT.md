# Multi-Agent Architecture (v0.2.0)

**TL;DR:** An agent can spawn sub-agents that share a workspace, communicate via a whiteboard, and have lineage tracked in the database. All coordination survives server restarts.

## The mental model

Think of OpenCentravity like a kitchen:

- **Root agent** = the head chef who takes an order
- **Sub-agents** = sous chefs, pastry chefs, dishwashers
- **Swarm** = the kitchen team, with a shared order ticket
- **Whiteboard** = the wall where they write notes for each other
- **File locks** = the rule that only one chef at a time uses a knife
- **LWM (Liquid Working Memory)** = each chef's mental focus, snapshot for replay

## Roles

Every agent has a `role` field on its row:

| Role | What it does | Tool access |
|------|-------------|-------------|
| `coder` (default) | Writes code, runs commands, edits files | Full access |
| `verifier` | Reviews code, runs Z3 proofs, checks tests | Read-only + z3_verify |
| `researcher` | Searches the codebase, summarizes findings | Read-only + semantic_search |
| `planner` | Decomposes tasks into execution plans | Pure LLM, no tools |
| `tester` | Runs tests, generates test artifacts | run_command + python_sandbox |

Set a role when creating an agent:
```ts
orchestrator.createAgent('Build me a REST API', { role: 'coder' });
```

## Lineage and swarms

Every agent has `parent_id` (NULL for root) and `swarm_id` (NULL for solo). The lineage is a tree:

```
root (swarm S1)
├── coder-1 (swarm S1)
├── verifier-1 (swarm S1)
└── researcher-1 (swarm S1)
```

Query the tree via:
```bash
GET /agents/<root_id>/children
```

## Delegation

The `delegate_task` tool spawns a sub-agent. v0.2.0 adds:

- `role` parameter (coder/verifier/researcher/...)
- `parallel_count` for fan-out (spawn N identical agents in parallel)
- `swarm_id` to join an existing swarm

Example from an LLM's tool call:
```json
{
  "tool": "delegate_task",
  "input": {
    "task": "Review the auth code in src/auth.ts for security issues",
    "role": "verifier",
    "swarm_id": "swarm-abc-123"
  }
}
```

## Inter-agent messaging

Agents in the same swarm can talk via the `message_agent` tool. Messages are persisted in `inter_agent_messages` and survive restarts.

## File locks

The `acquire_lock` / `release_lock` tools prevent two agents from editing the same file at once. Locks auto-expire after 5 minutes (configurable) so a crashed agent doesn't block the team.

## Cost tracking

Every LLM call writes to `cost_events` with token counts and USD cost. The gateway calculates cost from the model's `costPerInputToken` / `costPerOutputToken` fields. The orchestrator enforces `MAX_COST_USD` per swarm.

## LWM snapshots

Each agent's "Liquid Working Memory" is snapshot to `lwm_snapshots` every 10 ticks (configurable). The Manager UI will use these to replay what the agent was focused on at any point in time.

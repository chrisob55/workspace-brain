# Workspace Brain Architecture v1

## Product
- Product Name: Workspace Brain
- Mission: Workspace Brain discovers, indexes and organises knowledge from local workspaces, repositories and documents, producing Knowledge Models that can be consumed by AI OS and future AI agents.

## Core Architecture
- Workspace Brain = Knowledge Model Production Platform
- AI OS = Digital Brain, Governance, Knowledge Ledger and Reasoning Platform
- Source repositories remain authoritative
- Provenance is mandatory
- AI produces candidates, not accepted knowledge

## Completed Design Areas

### Vision & Boundaries
- Product boundary defined
- AI OS relationship defined
- Core principles defined

### Conceptual Model
- Workspace
- Source
- Repository
- Document
- Evidence
- Entity
- Relationship
- Assertion
- Knowledge
- Provenance
- Knowledge Model

### Information Architecture
- Configuration Schema
- Domain Model
- Knowledge Lifecycle
- Relationship Vocabulary
- Provenance Model
- Event Model
- Search Model
- DuckDB Schema
- OpenAPI Contract

### Runtime Architecture
- Service Catalogue
- AI Provider Contract
- Processor Plug-in Model
- Storage Ownership Matrix
- Monorepo Structure
- Docker Compose Topology
- Observability Strategy

### Delivery
- MVP Scope
- Post-MVP Roadmap
- ADR Catalogue

## Runtime Services
1. workspace-brain-api
2. ingestion-worker
3. knowledge-worker
4. web-ui
5. cli

Infrastructure:
- DuckDB
- Qdrant
- NATS
- Ollama

## Key Outputs
Workspace Brain publishes:
- Versioned Knowledge Models
- Evidence-backed understanding
- Provenance-rich knowledge representations

AI OS consumes:
- Published Knowledge Models

## Status
Architecture design phase complete.
Ready for repository scaffolding and implementation in VS Code.

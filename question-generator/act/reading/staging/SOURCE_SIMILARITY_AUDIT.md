# ACT Reading source-similarity audit

Generated: 2026-08-19T13:37:13.739Z

## Executive finding

The portfolio has **very low textual-copy risk** but uneven **conceptual and structural distance**. The average weighted similarity score is **2.8/10**, while the average holistic disguised-rewrite risk is **4.3/10**. Seven batches should be redesigned before publication because their narrative or argumentative skeleton remains conspicuously close to the corresponding source.

Across all 30 source-to-generation comparisons, the maximum content-word Jaccard similarity is **8.3%**, the longest exact run is **4 words**, and the total number of shared five-word sequences is **0**. The short exact runs are boilerplate such as passage labels, not source expression.

This is an editorial risk assessment, not a legal opinion.

## Scale and weighting

Every score uses **1 = minimal resemblance** and **10 = near-copy or strongly disguised rewrite**. Overall similarity weights wording and factual overlap most heavily: wording/syntax 20%, facts/entities/examples 20%, and each remaining evidence dimension 10%. The separate disguised-rewrite score is a holistic judgment that deliberately gives more attention to conspicuous conceptual and structural transposition.

| Code | Dimension |
|---|---|
| W | Wording and syntax |
| F | Facts, entities, and examples |
| S | Subject matter |
| C | Central conceptual theme |
| P | Paragraph-function sequence |
| R | Overall rhetorical architecture |
| I | Distinctive imagery and motifs |
| Q | Question-logic transfer |
| D | Risk of feeling like a disguised rewrite |
| O | Weighted overall similarity |

## Complete scorecard

| Batch | Generated focus | W | F | S | C | P | R | I | Q | D | O | Decision |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| S1A | Changed public institutions | 1 | 1 | 3 | 6 | 5 | 6 | 2 | 5 | **4** | **3.1** | LOW |
| S1B | Private work becomes public | 1 | 1 | 1 | 2 | 3 | 3 | 1 | 3 | **2** | **1.7** | LOW |
| S2A | Changing library functions | 1 | 1 | 2 | 5 | 6 | 6 | 1 | 5 | **4** | **2.9** | LOW |
| S2B | Desert germination strategies | 1 | 1 | 3 | 5 | 5 | 5 | 1 | 4 | **4** | **2.7** | LOW |
| S3A | Fog water in coastal forests | 1 | 1 | 3 | 5 | 6 | 6 | 2 | 5 | **4** | **3.1** | LOW |
| S3B | Neighborhood heat sensors | 1 | 1 | 2 | 4 | 6 | 6 | 1 | 5 | **4** | **2.8** | LOW |
| S4A | Recovered belongings and a traveling map | 1 | 1 | 1 | 3 | 2 | 2 | 2 | 3 | **3** | **1.7** | LOW |
| S4B | Hidden public-service coordination | 1 | 1 | 2 | 4 | 5 | 6 | 2 | 5 | **4** | **2.8** | LOW |
| S5A | Shipping-container standardization | 1 | 1 | 1 | 4 | 6 | 7 | 1 | 5 | **4** | **2.8** | LOW |
| S5B | Raised-dot reading systems | 1 | 1 | 4 | 6 | 6 | 7 | 2 | 6 | **5** | **3.5** | LOW |
| S6A | Public seating and social behavior | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 2 | **2** | **1.3** | LOW |
| S6B | Thermal tradeoffs in bat roosts | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 2 | **2** | **1.3** | LOW |
| S7A | Desert-ant navigation calibration | 1 | 1 | 3 | 2 | 3 | 3 | 1 | 3 | **3** | **1.9** | LOW |
| S7B | Farm cold-storage network | 1 | 1 | 2 | 7 | 7 | 7 | 2 | 6 | **6** | **3.5** | REVIEW |
| S8A | Apartment outage and hidden plumbing | 1 | 1 | 1 | 2 | 2 | 2 | 1 | 3 | **2** | **1.5** | LOW |
| S8B | Siblings sorting a cinema | 1 | 1 | 2 | 3 | 4 | 4 | 2 | 4 | **3** | **2.3** | LOW |
| S9A | Urban heat maps and resident routes | 1 | 1 | 4 | 6 | 6 | 7 | 2 | 7 | **6** | **3.6** | REVIEW |
| S9B | River restoration and access | 1 | 1 | 4 | 5 | 6 | 7 | 2 | 6 | **5** | **3.4** | LOW |
| S10A | Furniture repairs as evidence | 1 | 1 | 2 | 6 | 7 | 7 | 3 | 6 | **6** | **3.5** | REVIEW |
| S10B | Recipe cards as adaptable scores | 1 | 1 | 2 | 6 | 7 | 7 | 2 | 6 | **6** | **3.4** | REVIEW |
| S11A | Porous-clay produce cooling | 1 | 1 | 2 | 5 | 7 | 7 | 1 | 6 | **5** | **3.2** | LOW |
| S11B | Bacterial concrete sealing | 1 | 1 | 2 | 4 | 7 | 7 | 1 | 6 | **5** | **3.1** | LOW |
| S12A | Orchard notebook and radio tools | 1 | 1 | 3 | 6 | 6 | 7 | 3 | 7 | **6** | **3.6** | REVIEW |
| S12B | Bowling and weather records | 1 | 1 | 2 | 5 | 6 | 7 | 2 | 6 | **5** | **3.2** | LOW |
| S13A | Rag collection and paper mills | 1 | 1 | 3 | 6 | 8 | 8 | 2 | 7 | **7** | **3.8** | REVIEW |
| S13B | Telephone answering bureaus | 1 | 1 | 2 | 5 | 8 | 8 | 1 | 7 | **7** | **3.5** | REVIEW |
| S14A | Coordination in moving processions | 1 | 1 | 2 | 1 | 2 | 2 | 1 | 2 | **2** | **1.4** | LOW |
| S14B | Reconstructed historic buildings | 1 | 1 | 4 | 7 | 8 | 8 | 3 | 7 | **7** | **4.1** | REVIEW |
| S15A | Shorebird stopover departures | 1 | 1 | 1 | 2 | 2 | 2 | 1 | 2 | **2** | **1.4** | LOW |
| S15B | Phase-change thermal panels | 1 | 1 | 4 | 5 | 7 | 7 | 2 | 6 | **5** | **3.5** | LOW |

## Redesign before publication


The most concerning batch is **S8A**. It replaces romance with apprenticeship but retains an orchestrated meeting, attraction to a commitment, approval from one community, family resistance, and a deliberate choice. That reads like a domain-swapped version of the source arc. **S4A**, **S6A**, **S6B**, and **S7A** also preserve unusually recognizable experiential or conceptual skeletons. **S14A** and **S15A** are factually independent but remain too adjacent in debate structure or scientific domain to offer the desired safety margin.

## Review and optionally restructure

- **S7B — Farm cold-storage network:** The biological network becomes institutional infrastructure, but hubs, exchanges, uneven benefits, and resilience preserve a recognizable network argument.
- **S9A — Urban heat maps and resident routes:** Both paired texts compare approaches to an urban environmental problem. The evidence types and policy question are new, but the complementary-perspective architecture is visible.
- **S10A — Furniture repairs as evidence:** A personal encounter expands into an argument about artifacts, memory, and interpretive limits, echoing the source's personal-to-essay movement without its photographic or place details.
- **S10B — Recipe cards as adaptable scores:** The failed recreation and revised understanding mirror the source's encounter-led reflection, though cooking, tacit instruction, and access are independent.
- **S12A — Orchard notebook and radio tools:** Intergenerational inheritance and incomplete knowledge remain central, but mothers, migration, water, art, cities, and the source events are absent.
- **S13A — Rag collection and paper mills:** The commodity changes completely, but collection, growth, scarcity, industrial replacement, decline, and specialized survival closely follow the source industry's historical sequence.
- **S13B — Telephone answering bureaus:** The service domain is remote, yet expansion, operating infrastructure, disruptive automation, contraction, and niche survival closely preserve the source's industry arc.
- **S14B — Reconstructed historic buildings:** It repeats a debate over authentic originals and accessible mediation, but shifts the reasoning into spatial evidence, safety, reversibility, and preservation.

These batches do not copy wording, facts, names, quotations, or examples. Their risk comes from retaining a conspicuous sequence of paragraph jobs or the same conceptual opposition. They can usually be de-risked by changing the opening strategy, causal order, evidence hierarchy, and conclusion—not merely by swapping nouns.

## Low-risk batches

S1A, S1B, S2A, S2B, S3A, S3B, S4A, S4B, S5A, S5B, S6A, S6B, S7A, S8A, S8B, S9B, S11A, S11B, S12B, S14A, S15A, S15B

## Recommended release gate

1. Replace the seven REDESIGN batches with new blueprints whose central conflict or explanatory mechanism is different from the source—not only a different topic.
2. Give the REVIEW batches a targeted structural pass. At minimum, change two of these three elements: opening move, evidence/episode sequence, or final synthesis.
3. Rerun `measure-source-similarity.js` after revisions. Keep zero shared five-word sequences and investigate any exact run above four words.
4. Repeat this editorial scorecard after revisions; target disguised-rewrite risk of 5 or lower for every batch.

## Per-batch rationale

- **S1A (LOW, D 4/10, O 3.1/10):** The return-and-reassessment theme remains, but geographic homecoming, migration, family, photography, and cultural belonging are replaced by institutional stewardship.
- **S1B (LOW, D 2/10, O 1.7/10):** Public recognition and collaborative credit are materially remote from the source's return-home narratives.
- **S2A (LOW, D 4/10, O 2.9/10):** The domain is new, but the classify-responses-and-qualify-change structure resembles the source's urban-species classification.
- **S2B (LOW, D 4/10, O 2.7/10):** Both are ecology passages comparing adaptive strategies, though organisms, environment, mechanisms, evidence, and claims differ.
- **S3A (LOW, D 4/10, O 3.1/10):** It retains a field-anomaly-to-alternative-mechanism arc, but replaces early-life geology and source events with forest hydrology.
- **S3B (LOW, D 4/10, O 2.8/10):** The field surprise and sampling-correction architecture remain, while the scientific domain and evidence are independent.
- **S4A (LOW, D 3/10, O 1.7/10):** The paired form remains, but workplace memoir, sensory craft, mentors, and vocational recognition are replaced by two distinct reflections on memory, use, and object circulation.
- **S4B (LOW, D 4/10, O 2.8/10):** Expert routines and revised outsider perception echo the source generally, but the systems, crises, and sensory logic are substantially different.
- **S5A (LOW, D 4/10, O 2.8/10):** It preserves a correction-of-simplified-invention-history architecture but replaces numerical representation with physical interoperability.
- **S5B (LOW, D 5/10, O 3.5/10):** Both concern representational systems and adoption, but tactile encoding, user refinement, and institutional resistance are independent examples.
- **S6A (LOW, D 2/10, O 1.3/10):** An observational design study with controlled changes and explicit causal limits is materially remote from the source's biographical group-to-solo career narrative.
- **S6B (LOW, D 2/10, O 1.3/10):** Physiology, predator cues, thermal experiments, reproduction, and weather replace every creative-career, family-group, mentorship, and authorship element.
- **S7A (LOW, D 3/10, O 1.9/10):** Both are biological research passages, but individual navigation, cue conflict, calibration, confidence, and search replace mutualism, exchange networks, and ecosystem scaling.
- **S7B (REVIEW, D 6/10, O 3.5/10):** The biological network becomes institutional infrastructure, but hubs, exchanges, uneven benefits, and resilience preserve a recognizable network argument.
- **S8A (LOW, D 2/10, O 1.5/10):** A teenager tests evidence during a water outage and revises an unfair judgment; romance, courtship, family approval, resistance, and commitment are wholly absent.
- **S8B (LOW, D 3/10, O 2.3/10):** Sibling grief, archival evidence, and negotiated memory are materially different from courtship, marriage, and cultural family expectations.
- **S9A (REVIEW, D 6/10, O 3.6/10):** Both paired texts compare approaches to an urban environmental problem. The evidence types and policy question are new, but the complementary-perspective architecture is visible.
- **S9B (LOW, D 5/10, O 3.4/10):** It retains paired environmental viewpoints but shifts to ecological recovery, public access, stewardship, and distinct standards of success.
- **S10A (REVIEW, D 6/10, O 3.5/10):** A personal encounter expands into an argument about artifacts, memory, and interpretive limits, echoing the source's personal-to-essay movement without its photographic or place details.
- **S10B (REVIEW, D 6/10, O 3.4/10):** The failed recreation and revised understanding mirror the source's encounter-led reflection, though cooking, tacit instruction, and access are independent.
- **S11A (LOW, D 5/10, O 3.2/10):** Both explain a resource technology from mechanism to scale constraints, but energy generation becomes evaporative storage and all technical facts change.
- **S11B (LOW, D 5/10, O 3.1/10):** The problem-solution-mechanism-field-limit arc is retained at a generic level; biological concrete repair is otherwise remote from artificial photosynthesis.
- **S12A (REVIEW, D 6/10, O 3.6/10):** Intergenerational inheritance and incomplete knowledge remain central, but mothers, migration, water, art, cities, and the source events are absent.
- **S12B (LOW, D 5/10, O 3.2/10):** Community memory and imperfect records retain a broad inheritance theme while replacing family journeys with archival selection and evidentiary caution.
- **S13A (REVIEW, D 7/10, O 3.8/10):** The commodity changes completely, but collection, growth, scarcity, industrial replacement, decline, and specialized survival closely follow the source industry's historical sequence.
- **S13B (REVIEW, D 7/10, O 3.5/10):** The service domain is remote, yet expansion, operating infrastructure, disruptive automation, contraction, and niche survival closely preserve the source's industry arc.
- **S14A (LOW, D 2/10, O 1.4/10):** The passage explains distributed timing cues in live moving ensembles and contains no translation, authenticity, substitution, access, or opposing-position debate.
- **S14B (REVIEW, D 7/10, O 4.1/10):** It repeats a debate over authentic originals and accessible mediation, but shifts the reasoning into spatial evidence, safety, reversibility, and preservation.
- **S15A (LOW, D 2/10, O 1.4/10):** A probabilistic behavioral-ecology study of fuel, wind, season, habitat, and risk is remote from steelmaking, material structure, industrial process, and invention history.
- **S15B (LOW, D 5/10, O 3.5/10):** It retains process-to-property-to-scale reasoning but uses reversible thermal storage, encapsulation, buildings, and operating cycles rather than metallurgy.

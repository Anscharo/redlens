# Chatbot Benchmark Questions

13 governance questions used to evaluate model quality and atlas_query retrieval.
Run against Qwen3 32B (default) and any candidate replacement before promoting a new default model.

---

1. **Distribution rewards ledger**
   Which agents have paid distribution rewards out and how much?
   *(Not directly in the Atlas — expected to surface from active data sections; partial answer acceptable)*

2. **Integration boost vendors**
   What are all of the integration boost vendors?

3. **Pioneer agents**
   Which agents are Pioneers, for which chains, and when did they gain that status?

4. **Atlas Axis / Redline / Soter hierarchy**
   How does Atlas Axis team relate to Redline and Soter? Is there a hierarchy implied?

5. **Token transfer ledger**
   Find all of the token transfers documented in the Atlas and give me a ledger of who sent what, how much and when.

6. **Multisig security audit**
   Look at all of the multisigs and make security recommendations based on the purpose of the multisig, signer counts, signer groupings and execution thresholds.

7. **Primitives structure report**
   How are primitives structured? Which ones are always defined for an agent, which are optional? Generate a report.

8. **Spell execution history**
   Can you see anything about spell execution history?

9. **Roles, organizations, individuals**
   What are all of the roles and positions designated by the Atlas?
   What are all of the organizations recognized by the Atlas and what are their relationships to each other?
   Who are all of the individuals noted by the Atlas?

10. **Atlas history trends**
    What trends do you notice over the history of the Atlas being updated?

11. **Atlas edit timeline**
    Generate a timeline of major edits to the Atlas over the past 2 years and give a quarterly report on what the major theme and trend of the edits for each quarter was.

12. **"Did you know" blurbs**
    Generate 10 "Did you know" blurbs to educate people on key elements of the Atlas.

---

## Scoring notes

- Questions 1, 8 test graceful handling of sparse/missing data
- Questions 5, 6 test structured extraction across many nodes
- Questions 9, 10, 11 test graph traversal + history query depth
- Question 4 tests relationship inference from graph edges
- Questions 2, 3, 7 are factual recall baselines

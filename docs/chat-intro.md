# Sky Atlas Redline Chat: A Brief Introduction

Note this is a human-written summary; for a full overview see [docs/chat-system.md](chat-system.md).

## Tracing the Cycle From Prompt to Response

You write a prompt to the chatbot on Sky Atlas By Redline. What happens next?

The first thing to know is that the prompt is not the first thing the LLM sees. First is the system prompt.

### System Prompt

Our system prompt has 2 parts. The first is static and describes what the chat is, basics on the structure of the Atlas, tools that can be called, and how to cite findings. The second is not a singular bit of info but rather various types of information that are injected depending on the user's prompt. These tell the LLM about what doc or page a user is looking at, features of the chat and app, and info on entities mentioned in the Atlas. This way it knows for example if a prompt mentions "Spark" that Spark is an Agent and where to look up more info about it. All of this context is sent to the model along with your prompt. It uses this to choose to either respond with an answer or call a tool. However, we specifically instruct it to usually call a tool.

### Tools

Tools are essentially functions. The LLM is given a list of tool names, what params they need, what they return and a description of when to use each. We provide over 15 different tools. Roughly these allow querying the Atlas with lexical, semantic and graph search, looking up historic changes, viewing pre-made reports and exporting findings.

The LLM can call one or more of these tools each round. The results are then passed back into the LLM (starting a new round). The number of rounds is limited in code to prevent excessive use of tokens and get an answer back faster. When this max (set to about 5) is approaching or the model decides it has enough information it writes a response.

### Models and Verification

The response however is not directly sent to the user. Because we want to ensure high data quality we first verify the answer using deterministic checks and a second LLM consultation – apart from an exception for very simple questions not about Atlas content. All doc titles, doc numbers, UUIDs, and values, which can be deterministically checked against the Atlas itself, are checked. Any claims made in the original response are individually sent to another model along with the source the first claimed it came from where we ask "does this source support this claim?". If we can see that the UUID the model gave was wrong but it also gave the doc number which was correct we swap out the UUID using traditional programming. If the verifier models spot a mistake we then escalate to a smarter advisor. It will then say if the response needs to be rewritten, or info re-queried.

While I keep mentioning "The Model" the system actually uses several models that were determined to be the best quality / cost for the specific job they do for the Atlas chat. Base Model: google/gemma-4-31b-it, Strong Model: openai/gpt-5.6-luna, Advisor Model: anthropic/claude-haiku-4.5.

The strong model is used if our system detects that the question asked is sufficiently complex.

### The Returned Response

The verified and possibly revised response is then streamed to the user. Sources are linked. Verified claims receive visual approval. While obviously wrong remarks were already removed, ones we are unsure of are marked as such.

### Follow-up Prompts

Within a conversation each subsequent prompt sends to the LLM not only the next message but all previous messages from user to LLM and from LLM to user. These messages and conversations are therefore stored in our database.

## The Data

For the tool calls to be possible we first had to parse the Atlas and store its content and data in a database and other data structures. Postgres provides the basic data store. It holds each doc as a row, plus vectors for semantic search, a history table of revisions to each doc, and chat data. An inverted search index is held in memory on the server for lexical search (a copy of the same index is used client side for search). A graph of relationships of entities and actors mentioned in the Atlas is also stored both in memory on the server and sent to the front end -- powering features like radar. For more information on how we derive this graph from Atlas docs see [docs/graph-extraction.md](graph-extraction.md).

## How We Build and Update the Chat

Each decision of chat architecture and models used is backed by building a little evaluator and running a little competition of 3 to 5 options. The best are then iterated and retested. This is how we got to Gemma as the default model; it beat bigger more expensive models in our evals.

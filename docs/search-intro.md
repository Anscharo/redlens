# An Intro To Search 


## High Level 

The basic tech powering search is the [MiniSearch Library](https://lucaong.github.io/minisearch/) inside a web worker with some pre filtering / fast lookup for certain terms and post-filtering of results. 

Let look at both how the search system is prepared and indexed and secondly at the cycle from keystroke to result. 

Note that while this doc focuses on the search that users use in the browser part of its architecture is shared by the search available as MCP and used by chat. 

## The Setup

The search system needs 4 files, docs-shallow.json + docs-deep.json, the address files (addresses.atlas.json merged with on-chain addresses.json) and search-index.json -- The docs and address files are shared with general atlas reader system. These are built via a cron worker that checks for atlas updates every 12 minutes. If changes are found it updates entries in database, and builds the json structures which are also kept in the db as gzips (addresses.json sits at the site root, not in that gzip bundle). 

* search-index.json is Minisearch's inverted index of `title, doc_no, type, content` fields. 

* docs-shallow + docs-deep.json  -- since we already have all doc content in json we save space by reusing rather than including in the search index. Results give us just the uuid. Full UUID and doc number are hashmap lookups that bypass minisearch entirely; a partial UUID scans the id list. 

* addresses -- merged atlas + on-chain tables. A Sky chainlog id (MCD_VAT) is reverse-mapped to citing docs and merged with minisearch hits, not used instead of them. A 0x prefix is ordinary minisearch over content. 


When a visitor arrives on atlas.redline.support the gzipped atlas files are fetched -- search-index.json by the search worker, docs-shallow/deep by the atlas worker, address files and relations.json on the main thread -- and then used through-out the app. 


## A Search Is Born

When the search input box receives input this is what happens.

1. the url is updated to match the querystring
2. deferred value is given a pendingID and sent over to web worker (similar to debounce but not time based) 
3. regex shape matching checks if value is a UUID, or Doc Number, a hash map returns doc. if it is partial the list is iterated over. 
4. If not some prefiltering occurs: most special search syntax (`in:`, `type:`, quotes, `-exclude`) is stripped out to be reapplied in the post filtering. `term~N` is the exception -- that is converted for minisearch. 
5. minisearch receives terms and if given ~N will do a fuzzy search and gives a list of results. 
6. Postfiltering: These results are further filtered down, such as removing any that don't match exact quoted term when doing exact phrase matching, `in:` `type:`, `title:` filters, or capitalization check.
7. Snippets are created by finding the searched term in the found docs (substring for bare terms, regex for quoted phrases), noting the start, and expanding out a larger window of text to display
8. this is all serialized and sent from worker to react hook and rematched with original query based on pendingID. This ensures that the rendered results actually belong to the current search term.
9. while this is happening, our graph (relations.json) is also filtered for matches to the term
10. results from search worker and relations.json are rendered. 


## Why? 

* Docs is split into so that reader shallow and deep can render the first few levels without waiting for the entire doc file to download

* The search is entirely client side. Although this results in more data being sent over the wire and slightly slower start times. It provides for much faster searches (sub 10ms) vs the need to wait for a response from a server. 


## What the MCP Adds to Search 

The Above search is a lexical term search. The MCP takes the same minisearch index without the frontend's chainlog / `in:` / `title:` rewriting (it still post-filters `type:` and quoted phrases) and combines it with a semantic vector search. In this docs, docs + a breadcrumb of their ancestors' titles, or collections of doc in the case of for example Instance configuration doc parameters, are transformed into embeddings of vectors which represent their inherent meaning. This is useful as you don't have to use the exact terms to find the doc you are looking for and instead can use synonyms or related words. However, the downside for a search box is it can be confusing when the returned docs don't have the term you searched for. 
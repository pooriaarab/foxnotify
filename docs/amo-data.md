# What the foxnotify add-on sends, and its AMO data declaration

The manifest declares `data_collection_permissions: { "required": ["none"] }`.
This page lists everything that the add-on in `extension/` sends out of the
browser, and why no AMO data type applies to it today.

## The rule we apply

AMO's add-on policies, section 6, define data transmission:

> For the purposes of this policy, data transmission refers to any data that
> is collected, used, transferred, shared, or handled outside of the add-on or
> the local browser.

The page "Firefox built-in consent for data collection and transmission"
(https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
gives the data types that the manifest key declares, and says:

> You specify the data types your extension transmits in the
> `browser_specific_settings.gecko.data_collection_permissions` key in the
> `manifest.json` file.

> If your extension doesn't collect or transmit any data, you indicate that by
> specifying the `none` required permission in the manifest.

So the question for each item below is: is it one of the data types in that
taxonomy (personal data such as website content, website activity,
personal communications, or technical and interaction data)?

## What leaves the browser

| What | To whom | When | AMO data type |
|---|---|---|---|
| Desktop notices | Nobody. Firefox shows them on this computer. | Each notice | Not a transmission |
| The webhook body: the event kind (for example `needs-approval`), the priority, a fixed sentence that the add-on writes (for example "A task waits for your approval.") and the time | The URL that the user types in the settings, for example the user's own ntfy server | Only after the user types a URL, opens the request preview, and ticks "Send notices to this webhook". Off by default | None. The add-on writes all of this text. It holds nothing from a web page, nothing about the sites that the user visits, and nothing that the user typed. |
| The task title, in the webhook body | The same URL | Only when the user also ticks "Send the task title". Off by default | None for this add-on. The titles are the sample task titles that the user types in the popup. They come from no web page and describe no browsing. |
| The IP address of this computer | The webhook server | As part of any network connection | None. Every network request shows it; the taxonomy does not list it. |

The add-on does not use the foxsync phone link. Nothing goes to the
authors: the add-on has no analytics, no error reports and no server. The
webhook server is a server that the user picks and types in.

## Decision

With the webhook on, the add-on transfers data outside the browser. None of
that data is in an AMO data type, so `"none"` is the true declaration. The
listing says what leaves the browser and when.

## When this changes

A real agent, such as foxmate, makes task titles from the user's goal and
the page it works on, for example "Pay the bill on example-bank.com". Such a
title is `websiteActivity`, and can be `websiteContent`. An app that sends
those titles through a webhook or the phone link must declare those types,
and ask Firefox's consent before the first send when they are optional
(failure mode DC1). If this add-on starts to send such data, the same change
must update the manifest, this page and the listing (DC2).

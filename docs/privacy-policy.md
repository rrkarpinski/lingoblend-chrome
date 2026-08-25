# LingoBlend Privacy Policy

*Last updated: 2026-08-25*

LingoBlend is an independently developed Chrome extension that mixes target-language vocabulary into pages you browse to help with language learning.

## How LingoBlend works

LingoBlend reads the text of pages you visit locally on your device to find words to replace and to calculate the sentence-coverage statistics shown in the Analytics tab. Page text is processed in memory and is not sent to the developer or the processing service.

On muted sites, LingoBlend does not read or process the page.

## What is stored locally

LingoBlend stores the following data locally on your device:

- your vocabulary lists
- profile settings, including your profile name, languages, mixing rate, muted sites, and, if used, your enrichment API key
- aggregated mixing analytics, such as coverage statistics and lists of frequently missing words

This locally stored data is not transmitted to the developer or processing service during normal use.

## Optional vocabulary enrichment

LingoBlend includes an optional "Enrich vocabulary" feature. This feature is not required for the core functionality of the extension.

When you explicitly use the enrichment feature, the extension sends your vocabulary CSV to a processing service operated for the LingoBlend project. The request also includes your profile name, an automatically generated profile ID, your selected language pair, and an API key used to authorize access to the service.

The processing service processes the vocabulary to obtain translations and generate additional word forms. After processing, the resulting file is made available for the extension to download.

The service temporarily stores the input and resulting files while processing and until the result is retrieved. Files associated with a job are deleted after processing and are automatically removed after 24 hours at the latest.

The service does not use the contents of your vocabulary files for any purpose other than processing your enrichment request.

## API keys

An API key is required only to use the optional enrichment service. Keys are provided separately to individual users and are not included in the extension or its source code.

When you enter an API key into LingoBlend, it is stored locally with your profile and reused for subsequent enrichment requests. The key can be removed by deleting or changing the profile, and access can also be revoked by invalidating the key on the processing service.

## Processing service

The enrichment service is a Python application hosted on Render. Render provides the infrastructure on which the service runs.

The service keeps operational logs containing information such as the API key, profile name, profile ID, timestamps, processing progress, and request/status information. These logs do not contain the contents of uploaded vocabulary files.

## Your controls

You can delete any profile and its locally stored data from the LingoBlend dashboard at any time. Uninstalling the extension also removes its locally stored data.

## Changes

If this policy changes, the date above will be updated.

## Contact

LingoBlend is an independently developed project.

**Contact:** karpinski.rr@gmail.com
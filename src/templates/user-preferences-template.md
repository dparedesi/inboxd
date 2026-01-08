# Inbox Preferences

<!--
This file stores your inbox preferences. The AI assistant reads this
at the start of each session to personalize how it manages your email.
Keep it under 500 lines. Edit with: inboxd preferences --edit
-->

## About Me
<!-- Describe your context: job role, interests, what emails matter to you -->
<!-- Example entries (delete these and add your own): -->
- Software engineer interested in AI/ML opportunities
- Based in London, prefer remote-friendly roles
- Active on GitHub, receive many notifications

## Important People (Never Auto-Delete)
<!-- Senders whose emails should NEVER be suggested for deletion -->
<!-- Example: -->
- partner@gmail.com - spouse, always important
- hr@company.com - work-related

## Sender Behaviors
<!-- Rules for specific senders or domains -->
<!-- Examples: -->
- **LinkedIn job alerts** - When there are multiple, summarize the best matches for my profile and suggest deleting the rest
- **GitHub notifications** - Keep PRs I'm tagged on, archive others after reading

## Category Rules
<!-- Rules for types of emails -->
<!-- Examples: -->
- Bank/Financial emails - Archive after viewing, never delete
- Promotional emails older than 14 days - Can be auto-suggested for cleanup
- Newsletters I haven't read in 30 days - Suggest unsubscribing

## Behavioral Preferences
<!-- How you want the AI to behave -->
<!-- Examples: -->
- I prefer brief summaries (2-3 sentences)
- Always ask before deleting more than 10 emails at once
- On busy days (>50 unread), prioritize action-required emails

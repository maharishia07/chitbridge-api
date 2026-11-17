# SEC-143 web twin — critique (written with the change, the build was one hour)
(a) Brief assumed: app.html:4421 holds a masked "PIN or code" box — FALSE in this main (grep: no such line; the one box is public/app/signin-ui.js). till.html master — api tools/tally-connector/till.html (scripts/vendor-till.cjs), TRUE. signin-ui.js master — web, copied to the api kit by the same script, TRUE.
(b) No conflict with S6 or SEC-139 (verify answers after a secret). Better-not-copied: no vendor flow copied.
(c) Simpler: leave the machine and hide the answer fields — rejected, the box kind would still follow need/kind.
(d) Risks: landing order (api #883 first would break the window; web first is safe, the window ignores the old fields except use_pin/need). The api till PR and this PR carry one till.html and one signin-ui.js; vendor check passes both ways.
(e) VERDICT: BUILD WITH CHANGES — testid of the one box stays signin-code (20 walks type into it); local counter PIN box stays signin-pin.

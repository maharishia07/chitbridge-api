# deploy/mail-sink.Dockerfile — the proof mail sink as its own tiny image, for a cloud spin's test (HX2; deploy/mail-sink.cjs).
# Context = the two files only:  tar -C deploy -c mail-sink.cjs mail-sink.Dockerfile | docker build -t chitbridge-mailsink -f mail-sink.Dockerfile -
# A cloud sink is public: it answers only with MAIL_SINK_TOKEN (the spin's RESEND_API_KEY). Never part of a real deployment.
FROM node:22-alpine
COPY mail-sink.cjs /sink/mail-sink.cjs
USER node
ENV PORT=8025
EXPOSE 8025
CMD ["node", "/sink/mail-sink.cjs"]

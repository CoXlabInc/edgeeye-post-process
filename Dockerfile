FROM aler9/rtsp-simple-server AS rtsp
FROM node:20-alpine

RUN apk add --no-cache ffmpeg

COPY --from=rtsp /mediamtx /
COPY --from=rtsp /mediamtx.yml /

ENTRYPOINT [ "/mediamtx" ]

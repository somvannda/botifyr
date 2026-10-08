# Headless Blender (Cycles) for the offline office render.
#
#   docker build -t botifyr/blender:4.2 infra/blender
#   docker run --rm -v "$PWD:/work" botifyr/blender:4.2 \
#     -b -P /work/scripts/blender/office_render.py -- \
#     /work/office-scene.json /work/office-render.png /work/apps/portal/public/office3d
#
# No local Blender install needed; CPU rendering works out of the box.

FROM ubuntu:24.04

ARG BLENDER_VERSION=4.2.23

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates xz-utils \
      libx11-6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libsm6 libice6 \
      libxkbcommon0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL \
      "https://download.blender.org/release/Blender4.2/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
      -o /tmp/blender.tar.xz \
    && mkdir -p /opt/blender \
    && tar -xf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
    && rm /tmp/blender.tar.xz

ENV PATH=/opt/blender:$PATH
WORKDIR /work
ENTRYPOINT ["blender"]

#!/bin/bash
# Сборка модуля JSVM (QuickJS внутри GDExtension). Использование: tools/build_ext.sh linux|android
set -e
cd "$(dirname "$0")/../godot/ext"
mkdir -p third_party
pin() { git -C third_party/$1 fetch -q --depth 1 origin $2 && git -C third_party/$1 checkout -q $2; }
[ -d third_party/godot-cpp ] || { git clone -q https://github.com/godotengine/godot-cpp.git third_party/godot-cpp && pin godot-cpp d5cc777a89d899665fb61f1650ef0dc0cf6488c4; }
[ -d third_party/quickjs ] || { git clone -q https://github.com/bellard/quickjs.git third_party/quickjs && pin quickjs 7d1c13c5d8f8c6b32893786ed35cdcebd88194d2; }
if [ "$1" = "android" ]; then
  NDK=${ANDROID_NDK_ROOT:-${ANDROID_NDK_LATEST_HOME:-$ANDROID_HOME/ndk-bundle}}
  cmake -S . -B build-android -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake \
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 -DGODOTCPP_TARGET=template_release -DJSVM_SUFFIX=android.arm64
  ninja -C build-android
else
  cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DJSVM_SUFFIX=linux.x86_64
  ninja -C build
fi

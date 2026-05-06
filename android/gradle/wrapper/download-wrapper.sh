#!/bin/sh
# Downloads gradle-wrapper.jar if it doesn't already exist.
# Run this once before your first `./gradlew` call.
JAR_URL="https://github.com/gradle/gradle/raw/v8.13.0/gradle/wrapper/gradle-wrapper.jar"
JAR_PATH="$(dirname "$0")/gradle-wrapper.jar"

if [ -f "$JAR_PATH" ]; then
  echo "gradle-wrapper.jar already present."
  exit 0
fi

echo "Downloading gradle-wrapper.jar..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL -o "$JAR_PATH" "$JAR_URL"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$JAR_PATH" "$JAR_URL"
else
  echo "ERROR: curl or wget required"
  exit 1
fi
echo "Done."

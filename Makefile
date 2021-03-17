	# -pthread \
	# -s EXPORTED_FUNCTIONS="['_main', '_demux', '_initTransmux']" \

dist/ffprobe-wasm.js:
	mkdir -p dist && \
	emcc --bind \
	-O3 \
	-L/opt/ffmpeg/lib \
	-I/opt/ffmpeg/include/ \
	-s EXTRA_EXPORTED_RUNTIME_METHODS="[cwrap, ccall, getValue, setValue, writeAsciiToMemory]" \
	-s INITIAL_MEMORY=2GB \
	-s TOTAL_MEMORY=1500mb \
	-s TOTAL_STACK=1200mb \
	-s ASYNCIFY \
	-s MODULARIZE=1 \
	-lavcodec -lavformat -lavfilter -lavdevice -lswresample -lswscale -lavutil -lm -lx264 \
	-o dist/libav.js \
	src/main.cpp

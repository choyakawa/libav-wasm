	# -pthread \
	# -s EXPORTED_FUNCTIONS="['_main', '_demux', '_initTransmux']" \
	# -g4 --source-map-base http://localhost:1234/ \
	# -s EXTRA_EXPORTED_RUNTIME_METHODS="[cwrap, ccall, getValue, setValue, writeAsciiToMemory]" \

	# -pthread \
	# -s PROXY_TO_PTHREAD \
	# -s PTHREAD_POOL_SIZE=1 \
	# -sEXPORT_NAME=worker \

	# disable for build
	# -g \
	# -gsource-map \
	# --source-map-base http://localhost:1234/dist/ \
	# -s ASSERTIONS=2 \

dist/libav-wasm.js:
	mkdir -p dist && \
	emcc --bind \
	-L/opt/ffmpeg/lib \
	-I/opt/ffmpeg/include/ \
	-I/tmp/ffmpeg-5.1/ \
	-s FILESYSTEM=0 \
	-s ENVIRONMENT=web \
	-s INITIAL_MEMORY=1000mb \
	-s TOTAL_MEMORY=450mb \
	-s STACK_SIZE=200mb \
	-g \
	-gsource-map \
	--source-map-base http://localhost:1234/dist/ \
	-s ASSERTIONS=2 \
	-s ASYNCIFY \
	-s MODULARIZE=1 \
	-lavcodec -lavformat -lavfilter -lavdevice -lswresample -lswscale -lavutil -lm \
	-o dist/libav.js \
	src/main.cpp

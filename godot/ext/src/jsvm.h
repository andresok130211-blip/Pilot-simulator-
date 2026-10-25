#pragma once
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/string.hpp>
extern "C" {
#include "quickjs.h"
}
namespace godot {
class JSVM : public RefCounted {
	GDCLASS(JSVM, RefCounted)
	JSRuntime *rt = nullptr;
	JSContext *ctx = nullptr;
protected:
	static void _bind_methods();
public:
	JSVM();
	~JSVM();
	bool init();
	// выполняет код, возвращает строку результата или "ERR: ..."
	String eval(const String &code, const String &name);
	// JSON.stringify(fn(JSON-аргумент))
	String call(const String &fn, const String &json_arg);
};
}

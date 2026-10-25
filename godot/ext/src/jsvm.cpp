#include "jsvm.h"
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/utility_functions.hpp>
#include <cstring>
using namespace godot;

static JSValue js_print(JSContext *c, JSValueConst, int argc, JSValueConst *argv) {
	String s;
	for (int i = 0; i < argc; i++) {
		const char *p = JS_ToCString(c, argv[i]);
		if (i) s += " ";
		if (p) { s += String::utf8(p); JS_FreeCString(c, p); }
	}
	UtilityFunctions::print(String("[js] ") + s);
	return JS_UNDEFINED;
}

JSVM::JSVM() {}
JSVM::~JSVM() {
	if (ctx) JS_FreeContext(ctx);
	if (rt) JS_FreeRuntime(rt);
}
void JSVM::_bind_methods() {
	ClassDB::bind_method(D_METHOD("init"), &JSVM::init);
	ClassDB::bind_method(D_METHOD("eval", "code", "name"), &JSVM::eval, DEFVAL("eval"));
	ClassDB::bind_method(D_METHOD("call", "fn", "json_arg"), &JSVM::call, DEFVAL("null"));
}
bool JSVM::init() {
	if (rt) return true;
	rt = JS_NewRuntime();
	if (!rt) return false;
	JS_SetMemoryLimit(rt, (size_t)512 * 1024 * 1024);
	JS_SetMaxStackSize(rt, (size_t)4 * 1024 * 1024);
	ctx = JS_NewContext(rt);
	if (!ctx) return false;
	JSValue g = JS_GetGlobalObject(ctx);
	JSValue console = JS_NewObject(ctx);
	JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, js_print, "log", 1));
	JS_SetPropertyStr(ctx, console, "error", JS_NewCFunction(ctx, js_print, "error", 1));
	JS_SetPropertyStr(ctx, g, "console", console);
	JS_SetPropertyStr(ctx, g, "print", JS_NewCFunction(ctx, js_print, "print", 1));
	JS_FreeValue(ctx, g);
	return true;
}
static String exc_text(JSContext *ctx) {
	JSValue e = JS_GetException(ctx);
	String out = "ERR: ";
	const char *s = JS_ToCString(ctx, e);
	if (s) { out += String::utf8(s); JS_FreeCString(ctx, s); }
	JSValue st = JS_GetPropertyStr(ctx, e, "stack");
	if (!JS_IsUndefined(st)) { const char *t = JS_ToCString(ctx, st); if (t) { out += "\n"; out += String::utf8(t); JS_FreeCString(ctx, t); } }
	JS_FreeValue(ctx, st);
	JS_FreeValue(ctx, e);
	return out;
}
String JSVM::eval(const String &code, const String &name) {
	if (!ctx) return "ERR: not initialised";
	CharString cs = code.utf8();
	CharString nm = name.utf8();
	JSValue v = JS_Eval(ctx, cs.get_data(), cs.length(), nm.get_data(), JS_EVAL_TYPE_GLOBAL);
	if (JS_IsException(v)) return exc_text(ctx);
	String out;
	if (!JS_IsUndefined(v)) { const char *s = JS_ToCString(ctx, v); if (s) { out = String::utf8(s); JS_FreeCString(ctx, s); } }
	JS_FreeValue(ctx, v);
	return out;
}
String JSVM::call(const String &fn, const String &json_arg) {
	return eval(String("JSON.stringify(") + fn + "(" + json_arg + "))", fn);
}

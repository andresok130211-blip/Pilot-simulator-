#include <godot_cpp/godot.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include "jsvm.h"
using namespace godot;
void jsvm_init(ModuleInitializationLevel l) {
	if (l != MODULE_INITIALIZATION_LEVEL_SCENE) return;
	ClassDB::register_class<JSVM>();
}
void jsvm_term(ModuleInitializationLevel l) {}
extern "C" GDExtensionBool GDE_EXPORT jsvm_library_init(GDExtensionInterfaceGetProcAddress p, const GDExtensionClassLibraryPtr lib, GDExtensionInitialization *init) {
	GDExtensionBinding::InitObject o(p, lib, init);
	o.register_initializer(jsvm_init);
	o.register_terminator(jsvm_term);
	o.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return o.init();
}

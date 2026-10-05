cmake_minimum_required(VERSION 3.20)
project(StarGlassPanel LANGUAGES CXX RC)
if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
    message(FATAL_ERROR "StarGlass requires Windows x64")
endif()
set(IMGUI "${CMAKE_CURRENT_SOURCE_DIR}/vendor/imgui")
set(GLASS "${CMAKE_CURRENT_SOURCE_DIR}/vendor/liquidDX11")
set(FREETYPE "${CMAKE_CURRENT_SOURCE_DIR}/vendor/freetype")
add_executable(glasspanel
    ${IMGUI}/imgui.cpp
    ${IMGUI}/imgui_draw.cpp
    ${IMGUI}/imgui_tables.cpp
    ${IMGUI}/imgui_widgets.cpp
    ${IMGUI}/misc/freetype/imgui_freetype.cpp
    ${IMGUI}/backends/imgui_impl_dx11.cpp
    ${IMGUI}/backends/imgui_impl_win32.cpp
    ${GLASS}/glass/backdrop.cpp
    ${GLASS}/glass/glass.cpp
    glass-panel/panel_main.cpp
    glass-panel/panel.rc
)
target_compile_features(glasspanel PRIVATE cxx_std_17)
set_property(TARGET glasspanel PROPERTY CXX_STANDARD 17)
target_include_directories(glasspanel PRIVATE
    ${IMGUI} ${IMGUI}/backends ${GLASS} ${FREETYPE}/include
)
target_compile_definitions(glasspanel PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
if(MSVC)
    target_compile_options(glasspanel PRIVATE /W4 /utf-8)
endif()
target_link_libraries(glasspanel PRIVATE
    comctl32 uxtheme d3d11 d3dcompiler dxgi dwmapi user32 gdi32 ole32
    shell32 advapi32 ws2_32 winmm windowsapp windowscodecs ${FREETYPE}/win64/freetype.lib
)

#include <cstdio>
#include "glass_frame_cache.h"
int main(){
 GlassFrameKey saved{1,10,20,540,80,30,40};
 if(!GlassFrameCache::CanReuse(saved,saved,false,false))return 1;
 if(GlassFrameCache::CanReuse(saved,saved,true,false)||GlassFrameCache::CanReuse(saved,saved,false,true))return 2;
 auto next=saved;next.background++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 3;
 next=saved;next.x++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 4;
 next=saved;next.y++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 5;
 next=saved;next.w++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 6;
 next=saved;next.h++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 7;
 next=saved;next.mouseX++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 8;
 next=saved;next.mouseY++;if(GlassFrameCache::CanReuse(saved,next,false,false))return 9;
 std::puts("glass cache invalidation: background, move, resize, appearance, mouse and animation passed; no desktop window");return 0;
}

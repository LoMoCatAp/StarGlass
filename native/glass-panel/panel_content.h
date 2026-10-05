// Native content uses logical spacing scaled once for the current display.
// Included after PanelState and AddTextShadowed in panel_main.cpp.
static std::string FitText(ImFont* font, float size, std::string text, float width) {
    if (font->CalcTextSizeA(size, FLT_MAX, 0, text.c_str()).x <= width) return text;
    while (!text.empty()) {
        size_t end=text.size()-1;
        while (end && ((unsigned char)text[end]&0xc0)==0x80) --end;
        text.resize(end);
        if (font->CalcTextSizeA(size, FLT_MAX, 0, (text+"...").c_str()).x<=width) return text+"...";
    }
    return "...";
}

static std::vector<ImVec2> TrendPoints(const std::string& raw, ImVec2 start, ImVec2 end) {
    std::vector<std::pair<double,double>> samples;
    std::istringstream input(raw); std::string item;
    while (std::getline(input,item,',')) {
        const auto sep=item.find(':');
        if (sep==std::string::npos) continue;
        const double t=std::atof(item.substr(0,sep).c_str()), v=std::atof(item.substr(sep+1).c_str());
        if (std::isfinite(t)&&std::isfinite(v)) samples.emplace_back(t,v);
    }
    std::vector<ImVec2> result;
    if (samples.size()<2) return result;
    double lo=samples[0].second, hi=lo;
    for (const auto& p:samples) {lo=std::min(lo,p.second);hi=std::max(hi,p.second);}
    const double duration=std::max(1.0,samples.back().first-samples.front().first);
    for (const auto& p:samples) result.emplace_back(
        start.x+(float)((p.first-samples.front().first)/duration)*(end.x-start.x),
        hi==lo ? (start.y+end.y)*.5f : end.y-(float)((p.second-lo)/(hi-lo))*(end.y-start.y));
    return result;
}

static void PanelIcon(ImDrawList* dl, Glass::Icon icon, ImVec2 c, float size, ImU32 color, float thickness) {
    const float r=size*.42f;
    auto line=[&](float x,float y,float xx,float yy){dl->AddLine(ImVec2(c.x+x*r,c.y+y*r),ImVec2(c.x+xx*r,c.y+yy*r),color,thickness);};
    switch(icon) {
    case Glass::Icon::Minus: line(-1,0,1,0); break;
    case Glass::Icon::Sliders:
        for (int i=0;i<3;++i) {const float y=(float)i-1;line(-1,y,1,y);dl->AddCircleFilled(ImVec2(c.x+(i==1?-.3f:.4f)*r,c.y+y*r),thickness*1.3f,color);} break;
    case Glass::Icon::ChevronL: line(.4f,-.8f,-.4f,0);line(-.4f,0,.4f,.8f);break;
    case Glass::Icon::ChevronR: line(-.4f,-.8f,.4f,0);line(.4f,0,-.4f,.8f);break;
    case Glass::Icon::Download: line(0,-1,0,.5f);line(-.5f,0,0,.5f);line(0,.5f,.5f,0);line(-1,.5f,-1,1);line(-1,1,1,1);line(1,1,1,.5f);break;
    case Glass::Icon::ArrowUp: line(-.8f,.8f,.8f,-.8f);line(-.2f,-.8f,.8f,-.8f);line(.8f,-.8f,.8f,.2f);break;
    case Glass::Icon::Refresh: dl->PathArcTo(c,r,.4f,5.7f,20);dl->PathStroke(color,0,thickness);line(.8f,-.7f,.2f,-.7f);line(.8f,-.7f,.8f,-1.3f);break;
    default: Glass::DrawIcon(dl,icon,c,size,color,thickness);break;
    }
}

static std::string MiniCount(long long value) {
    if(value<0) return "--";
    if(value<10000) return WithSeparators(value);
    const double divisor=value>=1000000000000LL?1e12:value>=1000000000LL?1e9:value>=1000000LL?1e6:1e3;
    const char suffix=value>=1000000000000LL?'T':value>=1000000000LL?'B':value>=1000000LL?'M':'K';
    char buf[48];std::snprintf(buf,sizeof(buf),"%.1f%c",(double)value/divisor,suffix);
    std::string result=buf;const auto zero=result.find(".0");if(zero!=std::string::npos) result.erase(zero,2);
    return result;
}
static void DrawPanelText(int cw, int ch) {
    PanelState st;
    { std::lock_guard<std::mutex> lk(g_stateMutex); st=g_state; }
    if (st.glassOnly) return;
    static bool downloads=false;
    ImDrawList* dl=ImGui::GetBackgroundDrawList();
    ImFont* font=ImGui::GetIO().FontDefault;
    const float u=g_scale, fs=ImGui::GetFontSize(), pad=26*u, right=cw-pad, width=right-pad;
    g_textLightMix=g_autoText.LightMix();
    const ImU32 ink=PanelColor(IM_COL32(27,49,52,255),IM_COL32(247,251,250,255)), soft=PanelColor(IM_COL32(49,78,78,255),IM_COL32(215,231,226,255));
    const ImU32 accent=PanelColor(IM_COL32(29,111,91,255),IM_COL32(147,226,199,255)), line=PanelColor(IM_COL32(30,70,65,40),IM_COL32(235,250,246,48));
    const float footerY=ch-(st.showFooter?std::max(52*u,fs*.8f+26*u):10*u);
    const float nameSize=st.nameFontSize>0?st.nameFontSize*u:(st.mini?fs:fs*1.65f);
    auto text=[&](float x,float y,float size,ImU32 color,const std::string& value,float maxWidth=0.f) {
        const auto fitted=FitText(font,size,value,maxWidth>0?maxWidth:right-x);
        if(st.textColor=="auto"&&!fitted.empty()) {
            const ImVec2 bounds=font->CalcTextSizeA(size,FLT_MAX,0,fitted.c_str());
            g_autoText.regions.push_back({x,y,std::min(bounds.x,right-x),bounds.y});
        }
        AddTextShadowed(dl,font,size,ImVec2(x,y),color,fitted.c_str());
    };
    ImGui::SetNextWindowPos(ImVec2(0,0));
    ImGui::SetNextWindowSize(ImVec2((float)cw,(float)ch));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(0,0));
    ImGui::Begin("panel-content",nullptr,ImGuiWindowFlags_NoDecoration|ImGuiWindowFlags_NoBackground|
        ImGuiWindowFlags_NoSavedSettings|ImGuiWindowFlags_NoScrollbar|ImGuiWindowFlags_NoScrollWithMouse|ImGuiWindowFlags_NoMove|ImGuiWindowFlags_NoNav|ImGuiWindowFlags_NoBringToFrontOnFocus);
    auto hit=[&](const char* id,float x,float y,float w,float h,const char* hint) {
        ImGui::SetCursorScreenPos(ImVec2(x,y));
        const bool clicked=ImGui::InvisibleButton(id,ImVec2(w,h));
        if (ImGui::IsItemHovered()) {
            dl->AddRectFilled(ImVec2(x,y),ImVec2(x+w,y+h),IM_COL32(255,255,255,22),8*u);
            if (st.showTooltips&&hint&&*hint) {
                ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding,ImVec2(12*u,9*u));
                ImGui::PushStyleVar(ImGuiStyleVar_PopupRounding,10*u);
                ImGui::PushStyleColor(ImGuiCol_PopupBg,ImVec4(.89f,.94f,.92f,.97f));
                ImGui::PushStyleColor(ImGuiCol_Text,ImVec4(.106f,.192f,.204f,1.f));
                ImGui::PushStyleColor(ImGuiCol_Border,ImVec4(.5f,.67f,.6f,.55f));
                ImGui::SetTooltip("%s",hint);ImGui::PopStyleColor(3);ImGui::PopStyleVar(2);
            }
        }
        return clicked;
    };
    auto action=[&](const char* id,Glass::Icon icon,float x,float y,const char* hint,const char* command,bool enabled=true) {
        if (hit(id,x,y,30*u,30*u,hint)&&enabled) PanelSend(command);
        PanelIcon(dl,icon,ImVec2(x+15*u,y+15*u),15*u,enabled?soft:IM_COL32(180,197,190,120),1.5f*u);
    };
    if(st.mini) {
        const float inset=st.panelShape=="rectangle"?15*u:std::max(15*u,std::min((float)cw,(float)ch)*.25f),cy=ch*.5f;
        const auto slash=st.repo.find('/');
        const auto name=!st.displayName.empty()?st.displayName:st.repo.empty()?std::string(u8"添加项目"):st.repo.substr(slash==std::string::npos?0:slash+1);
        struct Metric {Glass::Icon icon;std::string value;float size;float width;};
        std::vector<Metric> metrics;
        if(st.showStars)metrics.push_back({Glass::Icon::Star,MiniCount(st.stars),st.starsFontSize>0?st.starsFontSize*u:fs*.92f,0});
        if(st.showDownloads)metrics.push_back({Glass::Icon::Download,MiniCount(st.downloads),st.downloadsFontSize>0?st.downloadsFontSize*u:fs*.92f,0});
        auto measure=[&](){float total=0;for(auto& m:metrics){m.width=font->CalcTextSizeA(m.size,FLT_MAX,0,m.value.c_str()).x+18*u;total+=m.width;}return total+std::max(0,(int)metrics.size()-1)*14*u;};
        float total=measure(),available=cw-inset*2-(st.showProjectName?std::min(80*u,cw*.3f):0.f);
        if(total>available&&!metrics.empty()){const float ratio=std::max(.1f,(available-(18.f*metrics.size()+14.f*(metrics.size()-1))*u)/std::max(1.f,total-(18.f*metrics.size()+14.f*(metrics.size()-1))*u));for(auto& m:metrics)m.size*=ratio;total=measure();}
        float x=st.showProjectName?cw-inset-total:(cw-total)*.5f;
        if(st.showProjectName){text(inset,(ch-nameSize)*.5f,nameSize,ink,name,metrics.empty()?cw-inset*2:std::max(1.f,x-inset-16*u));if(!metrics.empty())dl->AddLine(ImVec2(x-8*u,cy-7*u),ImVec2(x-8*u,cy+7*u),line);}
        for(const auto& m:metrics){PanelIcon(dl,m.icon,ImVec2(x+6*u,cy),12*u,soft,1.4f*u);text(x+18*u,(ch-m.size)*.5f,m.size,ink,m.value,m.width-18*u+1);x+=m.width+14*u;}
        ImGui::End();ImGui::PopStyleVar();return;
    }
    // The exact same rounded mark is used in the app, tray and native panel.
    const float hy=22*u;
    if (st.showLogo && g_logo) dl->AddImage((ImTextureID)(intptr_t)g_logo,ImVec2(pad-3*u,hy-3*u),ImVec2(pad+27*u,hy+27*u));
    if (st.showBrandText) text(pad+(st.showLogo?32*u:0),hy+2*u,fs*.92f,ink,"StarGlass");
    action("settings",Glass::Icon::Sliders,right-66*u,hy-3*u,u8"打开设置","CMD openSettings");
    action("hide",Glass::Icon::Minus,right-30*u,hy-3*u,u8"隐藏到托盘","CMD hide");

    if (st.repo.empty()) {
        text(pad,120*u,fs*1.6f,ink,u8"关注你热爱的项目");
        text(pad,170*u,fs*.95f,soft,u8"添加 GitHub 仓库，开始记录它的成长。");
        const float y=220*u;
        dl->AddRectFilled(ImVec2(pad,y),ImVec2(right,y+46*u),IM_COL32(48,108,89,180),12*u);
        text(pad+18*u,y+12*u,fs,ink,u8"+  添加项目");
        if (hit("add",pad,y,width,46*u,"")) PanelSend("CMD openSettings");
    } else {
        const size_t slash=st.repo.find('/');
        const std::string owner=st.repo.substr(0,slash), name=!st.displayName.empty()?st.displayName:slash==std::string::npos?st.repo:st.repo.substr(slash+1);
        float y=76*u;
        if(st.showOwner)text(pad,y,fs*.85f,soft,owner,width-95*u);
        if (st.repoCount>1) {
            text(right-85*u,y,fs*.8f,soft,std::to_string(st.repoIndex+1)+" / "+std::to_string(st.repoCount),45*u);
            action("prev",Glass::Icon::ChevronL,right-62*u,y-6*u,u8"上一个项目","CMD previousRepo");
            action("next",Glass::Icon::ChevronR,right-30*u,y-6*u,u8"下一个项目","CMD nextRepo");
        }
        if(st.showOwner||st.repoCount>1)y+=fs*.85f+10*u;
        if(st.showProjectName){text(pad,y,nameSize,ink,name,width-38*u);action("repo",Glass::Icon::ArrowUp,right-30*u,y,u8"在 GitHub 中查看","CMD openRepo");y+=nameSize+20*u;}
        if (!st.compact&&st.showDescription&&!st.description.empty()) {
            text(pad,y,fs*.87f,soft,st.description);
            y+=fs*.87f+20*u;
        }
        if(downloads&&!st.showDownloads)downloads=false;if(!st.showStars&&st.showDownloads)downloads=true;
        const int cards=st.showStars+st.showDownloads;const float gap=14*u,cardW=cards>0?(width-gap*(cards-1))/cards:width;
        const float starSize=st.starsFontSize>0?st.starsFontSize*u:fs*2.65f,downloadSize=st.downloadsFontSize>0?st.downloadsFontSize*u:fs*2.65f;
        const float cardH=std::max(fs*5.2f+34*u,std::max(st.showStars?starSize:0.f,st.showDownloads?downloadSize:0.f)+fs*2.1f+40*u);
        int cardIndex=0;
        for (int i=0;i<2;++i) {
            if(i==0?!st.showStars:!st.showDownloads)continue;
            const float x=pad+cardIndex++*(cardW+gap);
            const bool selected=downloads==(i==1);
            dl->AddRectFilled(ImVec2(x,y),ImVec2(x+cardW,y+cardH),PanelColor(IM_COL32(248,255,251,selected?32:16),IM_COL32(16,35,39,selected?64:32)),14*u);
            dl->AddRect(ImVec2(x,y),ImVec2(x+cardW,y+cardH),selected?PanelColor(IM_COL32(48,116,94,100),IM_COL32(164,231,205,105)):line,14*u);
            PanelIcon(dl,i?Glass::Icon::Download:Glass::Icon::Star,ImVec2(x+20*u,y+23*u),14*u,selected?accent:soft,1.5f*u);
            text(x+35*u,y+16*u,fs*.85f,soft,i?u8"累计下载":"GitHub Stars",cardW-43*u);
            const auto value=(i?st.downloads:st.stars)<0?std::string("--"):WithSeparators(i?st.downloads:st.stars);
            float nsize=i?downloadSize:starSize;
            const float measured=font->CalcTextSizeA(nsize,FLT_MAX,0,value.c_str()).x;
            if (measured>cardW-28*u) nsize*=(cardW-28*u)/measured;
            text(x+14*u,y+fs+25*u,nsize,ink,value,cardW-28*u);
            text(x+14*u,y+cardH-fs*.78f-14*u,fs*.78f,soft,i?u8"Release 附件":u8"每一份开源认可",cardW-28*u);
            if (hit(i?"downloads":"stars",x,y,cardW,cardH,u8"点击查看趋势")) downloads=i==1;
        }
        if(cards)y+=cardH+26*u;
        if (!st.compact&&st.showTrend&&cards) {
            text(pad,y,fs*.92f,ink,downloads?u8"下载趋势":u8"Star 趋势",width*.45f);
            text(right-69*u,y,fs*.78f,soft,u8"最近 7 天",69*u);
            const std::string delta=downloads?st.deltaDownloads:st.deltaStars;
            if (!delta.empty()) text(pad+95*u,y,fs*.8f,accent,(delta[0]=='-'?"":"+")+delta+u8" 较上次",width-178*u);
            y+=fs+20*u;
            const float bottom=footerY-(st.showMetadata?std::max(66*u,fs*.82f+39*u):10*u);
            if (bottom>y+24*u) {
                for (int i=0;i<3;++i) {const float yy=y+(bottom-y)*i/2; dl->AddLine(ImVec2(pad,yy),ImVec2(right,yy),line);}
                const auto points=TrendPoints(downloads?st.seriesDownloads:st.seriesStars,ImVec2(pad,y+4*u),ImVec2(right,bottom-4*u));
                if (points.size()>1) {
                    for (size_t i=1;i<points.size();++i) {
                        dl->AddQuadFilled(points[i-1],points[i],ImVec2(points[i].x,bottom),ImVec2(points[i-1].x,bottom),PanelColor(IM_COL32(29,111,91,20),IM_COL32(132,220,186,22)));
                        dl->AddLine(points[i-1],points[i],accent,2*u);
                    }
                    dl->AddCircleFilled(points.back(),3*u,accent);
                } else text(pad+12*u,y+(bottom-y)*.4f,fs*.85f,soft,u8"正在积累趋势，下一次采样后呈现",width-24*u);
            }
        }
        if(!st.compact&&st.showMetadata){
            const float metaY=footerY-std::max(35*u,fs*.82f+8*u);
            text(pad,metaY,fs*.82f,soft,(st.forks<0?std::string("--"):WithSeparators(st.forks))+" forks",width*.35f);
            text(pad+width*.4f,metaY,fs*.82f,soft,st.version.empty()?u8"暂无 Release":st.version,width*.6f);
        }
        if(st.showFooter){
        dl->AddLine(ImVec2(pad,footerY),ImVec2(right,footerY),line);
        const ImU32 statusColor=st.hasError?IM_COL32(250,193,123,255):accent;
        dl->AddCircleFilled(ImVec2(pad+3*u,footerY+22*u),3*u,statusColor);
        const std::string status=st.refreshing?u8"正在与 GitHub 同步…":st.hasError?u8"同步失败 · 保留上次数据":st.updated.empty()?u8"等待首次同步":st.updated+u8" 已更新";
        text(pad+14*u,footerY+14*u,fs*.8f,soft,status,width-55*u);
        if (st.hasError) hit("error",pad,footerY+7*u,width-44*u,30*u,st.status.c_str());
        action("refresh",Glass::Icon::Refresh,right-30*u,footerY+6*u,u8"刷新数据（最短间隔 1 分钟）","CMD refresh",!st.refreshing);
        }
    }
    if (st.fps) text(pad,ch-15*u,10*u,soft,std::to_string((int)ImGui::GetIO().Framerate)+" FPS");
    ImGui::End();
    ImGui::PopStyleVar();
}

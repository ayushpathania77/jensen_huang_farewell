"""Choose a documented set of distinct tech/community photographs from the catalogue."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'docs/photo-catalog-candidates.json'
catalog=json.loads(path.read_text(encoding='utf-8-sig'))
choices=[
 ('File:Jen-Hsun Huang Headshot (15313247387).jpg','hero-portrait-2014','Jensen Huang, photographed by NVIDIA in 2014.'),
 ('File:NVidiaMobileMediaPress JensenHuang.jpg','computex-2006','An early chapter: Jensen at COMPUTEX Taipei in 2006.'),
 ('File:Jensen Huang at Computex Taipei 20100531.jpg','computex-2010','Presenting at COMPUTEX Taipei, May 2010.'),
 ('File:GTC Taiwan 2016 – Tesla P40 & P40.jpg','gtc-taiwan-2016','On stage at NVIDIA’s GPU Technology Conference in Taiwan.'),
 ('File:Jensen Huang at Computex Taipei 20160531a.jpg','computex-2016-a','Sharing NVIDIA’s latest work at COMPUTEX Taipei in 2016.'),
 ('File:Jensen Huang at Computex Taipei 20160531b.jpg','computex-2016-b','A moment from the COMPUTEX Taipei presentation in 2016.'),
 ('File:Jensen Huang at Computex Taipei 20160531c.jpg','computex-2016-c','At the microphone during COMPUTEX Taipei in 2016.'),
 ('File:Jensen Huang at GTC Japan 20161005.jpg','gtc-japan-2016','Meeting the audience at GTC Japan, October 2016.'),
 ('File:Nvidia CEO Jensen Huang gestikuliert.jpg','onstage-2017','Jensen on stage, making a point in 2017.'),
 ('File:JensenHuangSC18.jpg','supercomputing-2018','Talking computing at the SC18 supercomputing conference.'),
 ('File:Wf2022 01.jpg','wirforce-2022','With the gaming community at WirForce in 2022.'),
 ('File:11.09 總統出席「第一屆李國鼎獎頒獎典禮」 - 53319959776.jpg','kt-li-award-2023','At the first K. T. Li Award ceremony in Taiwan, November 2023.'),
 ('File:NVIDIA 輝達執行長-黃仁勳 ， 航嘉顯示亞太區GM-謝宇睿.jpg','taipei-community-2025','A photograph with a technology industry colleague in Taipei.'),
 ('File:Jensen huang stanford 2026-04-30 003.jpg','stanford-selfie-003','Stopping for a photograph with Stanford students after a talk.'),
 ('File:Jensen huang stanford 2026-04-30 004.jpg','stanford-chip-004','Signing a computer chip after a Stanford CS 153 talk.'),
 ('File:Jensen huang stanford 2026-04-30 007.jpg','stanford-talk-007','In conversation with students in Stanford’s CS 153 course.'),
 ('File:Jensen huang stanford 2026-04-30 008.jpg','stanford-talk-008','Sharing a lesson with the next generation at Stanford.'),
 ('File:Jensen huang stanford 2026-04-30 010.jpg','stanford-conversation-010','A fireside conversation at Stanford, April 30, 2026.'),
 ('File:Jensen huang stanford 2026-04-30 014.jpg','stanford-audience-014','A full lecture hall for Jensen’s Stanford CS 153 visit.'),
 ('File:Jensen huang stanford 2026-04-30 023.jpg','stanford-selfie-023','One more photograph after the Stanford conversation.'),
 ('File:Jensen huang stanford 2026-04-30 024.jpg','stanford-students-024','A moment with students after the Stanford talk.'),
 ('File:Jensen huang stanford 2026-04-30 029.jpg','stanford-community-029','Students gather around Jensen following his Stanford visit.'),
 ('File:Jensen huang stanford 2026-04-30 031.jpg','stanford-laptop-031','Signing a student’s laptop after the Stanford talk.'),
]
selected=[]
bytitle={p.get('title'):p for p in catalog if isinstance(p,dict)}
for title,ident,caption in choices:
    p=dict(bytitle[title])
    assert not p['exclusionReason'], f'Excluded source selected: {title}'
    p.update(id=ident,caption=caption,filename=ident+'.jpg')
    selected.append(p)
for p in catalog:
    if not isinstance(p,dict) or not p.get('title'): continue
    if p['title'] in {t for t,_,_ in choices}:
        p['selection']='Selected'
    else:
        p['selection']='Excluded'
        if not p.get('exclusionReason'):
            p['exclusionReason']='Alternate crop of a selected photo' if 'cropped' in p['title'].lower() or p['title']=='File:Jensen Huang 20231109.jpg' else 'Political meeting rather than developer/community photography'
(ROOT/'docs/photo-catalog-selected.json').write_text(json.dumps(selected,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
path.write_text(json.dumps([p for p in catalog if isinstance(p,dict) and p.get('title')],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Curated {len(selected)} distinct photographs.')

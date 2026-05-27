"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Coffee, Plus, Trash2, Ticket, BarChart3, RotateCcw, Save, Shuffle, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function money(n) {
  return Number(n || 0).toLocaleString("ko-KR") + "원";
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      return value ? [value] : [];
    }
  }

  return [];
}

function formatRecordDate(value) {
  if (typeof value === "string" && value.length >= 10) {
    return value.slice(0, 10);
  }

  return todayString();
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateLadder(count, rows = 14) {
  const ladder = Array.from({ length: rows }, () => Array(count - 1).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < count - 1; c++) {
      const leftBlocked = c > 0 && ladder[r][c - 1];
      const canPlace = !leftBlocked && Math.random() < 0.35;
      if (canPlace) ladder[r][c] = true;
    }
  }
  return ladder;
}

function traceLadder(start, ladder) {
  let pos = start;
  const path = [];
  for (let r = 0; r < ladder.length; r++) {
    path.push({ row: r, col: pos });
    if (pos > 0 && ladder[r][pos - 1]) pos -= 1;
    else if (pos < ladder[r].length && ladder[r][pos]) pos += 1;
  }
  path.push({ row: ladder.length, col: pos });
  return { end: pos, path };
}

export default function CoffeeBetLadderApp() {
  const [people, setPeople] = useState([]);
  const [newPerson, setNewPerson] = useState("");
  const [records, setRecords] = useState([]);
  const [selected, setSelected] = useState({});
  const [couponUse, setCouponUse] = useState({});
  const [amount, setAmount] = useState(5000);
  const [gameType, setGameType] = useState("ladder");
  const [ladder, setLadder] = useState(null);
  const [result, setResult] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [highlightPath, setHighlightPath] = useState([]);
  const [ladderReady, setLadderReady] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState(null);
  const [finalCol, setFinalCol] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [personSaving, setPersonSaving] = useState(false);
  const [manualPickOpen, setManualPickOpen] = useState(false);
  const canvasRef = useRef(null);
  
  const supabase = useMemo(() => createClient(), []);

  // 데이터 불러오기
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 참여자 목록 가져오기
      const { data: peopleData, error: peopleError } = await supabase
        .from("people")
        .select("*")
        .order("created_at", { ascending: true });

      // 기록 가져오기
      const { data: recordsData, error: recordsError } = await supabase
        .from("coffee_records")
        .select("*")
        .order("created_at", { ascending: false });

      if (peopleError) console.error("people fetch error:", peopleError);
      if (recordsError) console.error("records fetch error:", recordsError);

      if (peopleData) {
        setPeople(peopleData.map((p) => p.name).filter(Boolean));
      }

      if (recordsData) {
        const recordsWithCoupons = recordsData.map((r, index) => ({
          id: r.id || `record-${index}`,
          date: formatRecordDate(r.created_at),
          gameType: r.game_type || "기록",
          loser: r.loser || "알 수 없음",
          amount: Number(r.amount || 0),
          participants: normalizeTextArray(r.participants),
          couponsUsed: normalizeTextArray(r.coupons_used),
          couponEarned: !!r.coupon_earned,
        }));
        setRecords(recordsWithCoupons);
      }
    } catch (error) {
      console.error("fetchData parse error:", error);
      toast({
        title: "데이터 불러오기 실패",
        description: error instanceof Error ? error.message : "레코드 형식이 올바르지 않습니다.",
        variant: "destructive",
      });
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const init = {};
    people.forEach((p) => (init[p] = true));
    setSelected(init);
  }, [people]);

  const stats = useMemo(() => {
    const map = {};
    people.forEach((p) => {
      map[p] = { name: p, loses: 0, paid: 0, couponsEarned: 0, couponsUsed: 0, couponsAvailable: 0 };
    });
    records.forEach((r) => {
      if (!map[r.loser]) map[r.loser] = { name: r.loser, loses: 0, paid: 0, couponsEarned: 0, couponsUsed: 0, couponsAvailable: 0 };
      map[r.loser].loses += 1;
      map[r.loser].paid += Number(r.amount || 0);

      // 쿠폰 사용 이력 반영
      (r.couponsUsed || []).forEach((name) => {
        if (!map[name]) map[name] = { name, loses: 0, paid: 0, couponsEarned: 0, couponsUsed: 0, couponsAvailable: 0 };
        map[name].couponsUsed += 1;
      });
    });

    // 3회마다 쿠폰 1장 지급, 사용한 쿠폰은 차감
    Object.values(map).forEach((s) => {
      s.couponsEarned = Math.floor(s.loses / 3);
      s.couponsAvailable = Math.max(0, s.couponsEarned - s.couponsUsed);
    });
    return map;
  }, [people, records]);

  const activePeople = useMemo(() => {
    return people.filter((p) => selected[p] && !couponUse[p]);
  }, [people, selected, couponUse]);

  const addPerson = async () => {
    const name = newPerson.trim();
    if (!name) {
      toast({
        title: "이름을 입력하세요.",
      });
      return;
    }

    if (people.includes(name)) {
      toast({
        title: "이미 등록된 인원입니다.",
        description: `${name} 은(는) 이미 목록에 있습니다.`,
      });
      return;
    }

    setPersonSaving(true);

    const { error } = await supabase
      .from("people")
      .insert([{ name }]);

    if (error) {
      console.error("people insert error:", error);
      toast({
        title: "인원 추가 실패",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPeople((prev) => [...prev, name]);
      setNewPerson("");
      toast({
        title: "인원을 추가했습니다.",
        description: name,
      });
    }

    setPersonSaving(false);
  };

  const removePerson = async (name) => {
    const { error } = await supabase
      .from("people")
      .delete()
      .eq("name", name);

    if (error) {
      console.error("people delete error:", error);
      toast({
        title: "인원 삭제 실패",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPeople((prev) => prev.filter((p) => p !== name));
    }
  };

  const runGame = () => {
    if (activePeople.length < 2) return;
    setIsRunning(true);
    setManualPickOpen(false);
    setResult(null);
    setHighlightPath([]);
    setLadderReady(false);
    setSelectedPerson(null);
    setFinalCol(null);

    const shuffled = shuffleArray(activePeople);

    if (gameType === "ladder") {
      const newLadder = generateLadder(shuffled.length, Math.max(10, shuffled.length * 4));
      const results = shuffled.map((_, i) => i === 0 ? "커피 당첨" : "통과");
      const shuffledResults = shuffleArray(results);
      
      setLadder({ 
        lines: newLadder, 
        top: shuffled, 
        bottom: shuffledResults
      });
      setLadderReady(true);
      setIsRunning(false);
    } else {
      const losingIndex = Math.floor(Math.random() * shuffled.length);
      setTimeout(() => {
        setResult({ loser: shuffled[losingIndex], type: "룰렛" });
        setIsRunning(false);
      }, 500);
    }
  };

  const selectManualLoser = (name) => {
    setManualPickOpen(false);
    setLadderReady(false);
    setSelectedPerson(null);
    setFinalCol(null);
    setHighlightPath([]);
    setLadder(null);
    setResult({ loser: name, type: "수동 기록" });
  };

  const handlePersonClick = (personIndex) => {
    if (!ladderReady || !ladder) return;
    
    setSelectedPerson(personIndex);
    setHighlightPath([]);
    setResult(null);
    setFinalCol(null);
    
    const animatePath = async () => {
      const rows = ladder.lines.length;
      const stepY = 1 / (rows + 1);
      const detailedPath = [];
      
      let currentCol = personIndex;
      
      detailedPath.push({ row: -1, col: currentCol, y: 0 });
      
      for (let r = 0; r < rows; r++) {
        detailedPath.push({ row: r, col: currentCol, y: (r + 1) * stepY });
        
        if (currentCol > 0 && ladder.lines[r][currentCol - 1]) {
          currentCol -= 1;
          detailedPath.push({ row: r, col: currentCol, y: (r + 1) * stepY });
        } else if (currentCol < ladder.lines[r].length && ladder.lines[r][currentCol]) {
          currentCol += 1;
          detailedPath.push({ row: r, col: currentCol, y: (r + 1) * stepY });
        }
      }
      
      detailedPath.push({ row: rows, col: currentCol, y: 1 });
      
      for (let i = 1; i <= detailedPath.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        setHighlightPath(detailedPath.slice(0, i));
      }
      
      setFinalCol(currentCol);
      
      const resultText = ladder.bottom[currentCol];
      if (resultText === "커피 당첨") {
        setResult({ loser: ladder.top[personIndex], type: "사다리" });
      }
    };
    
    animatePath();
  };

  const saveResult = async () => {
    if (!result) return;
    setSaving(true);

    const usedCoupons = Object.entries(couponUse)
      .filter(([, used]) => used)
      .map(([name]) => name);

    const nextLoseCount = (stats[result.loser]?.loses || 0) + 1;

    const { error } = await supabase
      .from("coffee_records")
      .insert({
        loser: result.loser,
        amount: Number(amount || 0),
        game_type: result.type,
        participants: activePeople,
        coupons_used: usedCoupons,
        coupon_earned: nextLoseCount % 3 === 0,
      });

    if (error) {
      console.error("record insert error:", error);
      alert("저장 실패: Supabase의 coffee_records 테이블에 participants, coupons_used, coupon_earned 컬럼이 있는지 확인하세요.");
    } else {
      await fetchData();
      setManualPickOpen(false);
      setResult(null);
      setCouponUse({});
    }

    setSaving(false);
  };

  const deleteRecord = async (id) => {
    if (!confirm("이 기록을 삭제하시겠습니까?")) return;

    const { error } = await supabase
      .from("coffee_records")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("record delete error:", error);
      toast({
        title: "기록 삭제 실패",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    setRecords((prev) => prev.filter((record) => record.id !== id));
  };

  const drawLadder = () => {
    const canvas = canvasRef.current;
    if (!canvas || !ladder?.lines) return;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const n = ladder.top.length;
    const rows = ladder.lines.length;
    const marginX = 45;
    const topY = 10;
    const bottomY = height - 10;
    const stepX = (width - marginX * 2) / Math.max(1, n - 1);
    const stepY = (bottomY - topY) / (rows + 1);

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#d1d5db";
    for (let i = 0; i < n; i++) {
      const x = marginX + i * stepX;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.stroke();
    }
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < n - 1; c++) {
        if (ladder.lines[r][c]) {
          const y = topY + (r + 1) * stepY;
          const x1 = marginX + c * stepX;
          const x2 = marginX + (c + 1) * stepX;
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
        }
      }
    }

    if (highlightPath.length > 1) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      
      for (let i = 0; i < highlightPath.length; i++) {
        const point = highlightPath[i];
        const x = marginX + point.col * stepX;
        const y = topY + point.y * (bottomY - topY);
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      ctx.stroke();
    }
  };

  useEffect(drawLadder, [ladder, highlightPath]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="flex items-center gap-3 text-neutral-600">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>데이터 불러오는 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-6 text-neutral-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 rounded-3xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-500">
              <Coffee className="h-4 w-4" /> Lab Coffee Bet Manager
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">연구실 커피 내기</h1>
            <p className="mt-2 text-neutral-600">참가자 선택, 면제 쿠폰, 사다리/룰렛 결과, 금액 기록과 통계를 한 번에 관리합니다.</p>
          </div>
          <a href="https://lazygyu.github.io/roulette/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm hover:bg-neutral-100">
            외부 룰렛 열기 <ExternalLink className="h-4 w-4" />
          </a>
        </header>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <div className="space-y-6">
            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-5">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Plus className="h-5 w-5" /> 인원 관리</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addPerson();
                  }}
                  className="flex gap-2"
                >
                  <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="이름 입력" className="min-w-0 flex-1 rounded-2xl border px-3 py-2 outline-none focus:ring-2 focus:ring-neutral-300" />
                  <Button type="submit" disabled={personSaving} className="rounded-2xl">
                    {personSaving ? "추가 중..." : "추가"}
                  </Button>
                </form>
                <div className="mt-4 space-y-2">
                  {people.map((p) => (
                    <div key={p} className="flex items-center justify-between rounded-2xl bg-neutral-100 px-3 py-2">
                      <div>
                        <div className="font-medium">{p}</div>
                        <div className="text-xs text-neutral-500">걸린 횟수 {stats[p]?.loses || 0}회 · 쿠폰 {stats[p]?.couponsAvailable || 0}장</div>
                      </div>
                      <button onClick={() => removePerson(p)} className="rounded-xl p-2 hover:bg-white"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-5">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Ticket className="h-5 w-5" /> 게임 전 설정</h2>

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setGameType("ladder")} className={`rounded-2xl border px-3 py-2 ${gameType === "ladder" ? "bg-neutral-900 text-white" : "bg-white"}`}>사다리</button>
                  <button onClick={() => setGameType("roulette")} className={`rounded-2xl border px-3 py-2 ${gameType === "roulette" ? "bg-neutral-900 text-white" : "bg-white"}`}>룰렛 기록</button>
                </div>

                <div className="mt-5 space-y-2">
                  <div className="text-sm font-medium">참여자 / 쿠폰 사용</div>
                  {people.map((p) => {
                    const available = stats[p]?.couponsAvailable || 0;
                    return (
                      <div key={p} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-2xl border bg-white px-3 py-2">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={!!selected[p]} onChange={(e) => setSelected({ ...selected, [p]: e.target.checked })} />
                          <span>{p}</span>
                        </label>
                        <span className="text-xs text-neutral-500">{available}장</span>
                        <label className={`flex items-center gap-1 text-xs ${available ? "" : "text-neutral-300"}`}>
                          <input type="checkbox" disabled={!available || !selected[p]} checked={!!couponUse[p]} onChange={(e) => setCouponUse({ ...couponUse, [p]: e.target.checked })} />
                          사용
                        </label>
                      </div>
                    );
                  })}
                </div>

                <Button disabled={activePeople.length < 2 || isRunning} onClick={runGame} className="mt-5 w-full rounded-2xl py-6 text-base">
                  <Shuffle className="mr-2 h-5 w-5" /> 내기 시작
                </Button>
                <Button
                  variant="outline"
                  disabled={activePeople.length < 1 || isRunning}
                  onClick={() => setManualPickOpen((prev) => !prev)}
                  className="mt-3 w-full rounded-2xl"
                >
                  다른 내기 결과 직접 기록
                </Button>
                {manualPickOpen && (
                  <div className="mt-3 space-y-2 rounded-2xl border bg-neutral-50 p-3">
                    <div className="text-sm font-medium">누가 걸렸는지 선택</div>
                    <div className="flex flex-wrap gap-2">
                      {activePeople.map((p) => (
                        <Button
                          key={p}
                          variant="secondary"
                          onClick={() => selectManualLoser(p)}
                          className="rounded-2xl"
                        >
                          {p}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-2 text-center text-xs text-neutral-500">실제 게임 참가자: {activePeople.length}명</div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-5">
                <h2 className="mb-4 text-xl font-semibold">게임 화면</h2>
                {gameType === "ladder" ? (
                  <div className="rounded-3xl bg-white p-4">
                    {ladder?.top ? (
                      <>
                        <div className="mb-2 grid" style={{ gridTemplateColumns: `repeat(${ladder.top.length}, minmax(0, 1fr))` }}>
                          {ladder.top.map((p, idx) => (
                            <button
                              key={p}
                              onClick={() => handlePersonClick(idx)}
                              disabled={!ladderReady}
                              className={`truncate text-center text-sm font-medium py-2 px-1 rounded-xl transition-all ${
                                ladderReady
                                  ? "cursor-pointer hover:bg-neutral-100 hover:scale-105"
                                  : ""
                              } ${selectedPerson === idx ? "bg-red-500 text-white" : ""}`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                        {ladderReady && (
                          <div className="mb-2 text-center text-sm text-neutral-500">
                            이름을 클릭하면 사다리를 타고 내려갑니다
                          </div>
                        )}
                        <canvas ref={canvasRef} width={760} height={420} className="h-[360px] w-full rounded-2xl bg-neutral-50" />
                        <div className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${ladder.bottom.length}, minmax(0, 1fr))` }}>
                          {ladder.bottom.map((b, i) => (
                            <div 
                              key={i} 
                              className={`truncate text-center text-xs py-2 ${
                                finalCol === i
                                  ? "font-bold text-red-500"
                                  : b === "커피 당첨" 
                                  ? "font-bold" 
                                  : "text-neutral-500"
                              }`}
                            >
                              {b}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[420px] items-center justify-center rounded-2xl bg-neutral-50 text-neutral-500">내기 시작을 누르면 랜덤 사다리가 생성됩니다.</div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-[420px] flex-col items-center justify-center rounded-3xl bg-white text-center">
                    <RotateCcw className="mb-3 h-12 w-12" />
                    <p className="text-lg font-medium">외부 룰렛을 사용한 뒤 결과를 이곳에 기록할 수 있습니다.</p>
                    <p className="mt-2 text-sm text-neutral-500">현재 버전에서는 내부 랜덤 추첨으로도 결과 저장이 가능합니다.</p>
                  </div>
                )}

                {result && (
                  <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-5 rounded-3xl bg-neutral-900 p-5 text-white">
                    <div className="text-sm text-neutral-300">오늘의 결과</div>
                    <div className="mt-1 text-3xl font-bold">{result.loser} 당첨</div>
                    <div className="mt-3">
                      <label className="text-sm text-neutral-300">결제 금액</label>
                      <input 
                        type="number" 
                        value={amount} 
                        onChange={(e) => setAmount(e.target.value)} 
                        className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-white outline-none focus:ring-2 focus:ring-neutral-500" 
                        placeholder="금액 입력"
                      />
                    </div>
                    <Button onClick={saveResult} disabled={saving} className="mt-4 rounded-2xl bg-white text-neutral-900 hover:bg-neutral-200">
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} 기록 저장
                    </Button>
                  </motion.div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-5">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><BarChart3 className="h-5 w-5" /> 통계</h2>
                <div className="overflow-hidden rounded-2xl border bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-100 text-neutral-600">
                      <tr>
                        <th className="p-3 text-left">이름</th>
                        <th className="p-3 text-right">걸린 횟수</th>
                        <th className="p-3 text-right">총 결제</th>
                        <th className="p-3 text-right">획득 쿠폰</th>
                        <th className="p-3 text-right">사용 쿠폰</th>
                        <th className="p-3 text-right">남은 쿠폰</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(stats).map((s) => (
                        <tr key={s.name} className="border-t">
                          <td className="p-3 font-medium">{s.name}</td>
                          <td className="p-3 text-right">{s.loses}</td>
                          <td className="p-3 text-right">{money(s.paid)}</td>
                          <td className="p-3 text-right">{s.couponsEarned}</td>
                          <td className="p-3 text-right">{s.couponsUsed}</td>
                          <td className="p-3 text-right font-semibold">{s.couponsAvailable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-3xl shadow-sm">
              <CardContent className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold">기록</h2>
                </div>
                <div className="space-y-2">
                  {records.length === 0 && <div className="rounded-2xl bg-neutral-100 p-4 text-sm text-neutral-500">아직 저장된 기록이 없습니다.</div>}
                  {records.map((r) => (
                    <div key={r.id} className="rounded-2xl border bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold">{r.date} · {r.loser} 당첨</div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-neutral-500">{r.gameType} · {money(r.amount)}</div>
                          <button
                            onClick={() => deleteRecord(r.id)}
                            className="rounded-xl p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
                            aria-label="기록 삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {!!r.participants?.length && (
                        <div className="mt-2 text-sm text-neutral-600">참여: {r.participants.join(", ")}</div>
                      )}
                      {!!r.couponsUsed?.length && (
                        <div className="mt-1 text-sm text-neutral-600">쿠폰 사용: {r.couponsUsed.join(", ")}</div>
                      )}
                      {r.couponEarned && (
                        <div className="mt-2 inline-flex rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">3회 누적: 면제 쿠폰 1장 지급</div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

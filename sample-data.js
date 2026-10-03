window.COMMUTE_SAMPLE_DATA = {
  "appVersion": "2.0",
  "documentType": "commute_slip",
  "targetMonth": "令和8年10月分",
  "submissionDate": "令和8年11月1日",
  "companyName": "架空警備株式会社",
  "demoMode": true,
  "people": [
    {
      "id": "demo-yamada",
      "name": "山田 太郎",
      "employeeCode": "000001",
      "address": "サンプル県ひかり市青葉1-2-3",
      "nearestStations": ["サンプル駅A", "サンプル駅B"],
      "hankoName": "山田",
      "showDigitalHanko": true,
      "hankoScale": 1.2,
      "notes": "公開用の架空デモデータです。",
      "entries": [
        {"date":"10月2日","workType":"日勤","clientName":"サンプル建設株式会社 首都圏事業部","siteName":"青葉通り共同庁舎新館工事A","siteAddress":"サンプル都中央区1-2-3","nearestStation":"サンプル中央駅","route":"サンプル駅A ↔ サンプル中央駅","transport":"電車","oneWayFare":320,"roundTripFare":640,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"},
        {"date":"10月5日","workType":"夜勤","clientName":"デモ設備","siteName":"駅前改修B","siteAddress":"サンプル都みどり区4-5-6","nearestStation":"テスト港駅","route":"サンプル駅A ↔ テスト港駅","transport":"電車","oneWayFare":410,"roundTripFare":820,"fareType":"IC","verificationUrl":"https://www.google.com/maps","memo":"確認リンクの表示例"},
        {"date":"10月12日","workType":"研修","clientName":"架空警備株式会社","siteName":"教育センター","siteAddress":"サンプル県学園市7-8-9","nearestStation":"研修センター前","route":"サンプル駅A ↔ 研修センター前","transport":"電車・バス","oneWayFare":280,"roundTripFare":560,"fareType":"IC","verificationUrl":"","memo":"バス利用の入力例"},
        {"date":"10月18日","workType":"日勤","clientName":"テスト通信","siteName":"データセンターC","siteAddress":"サンプル都北区10-11-12","nearestStation":"デモタワー駅","route":"サンプル駅A ↔ デモタワー駅","transport":"電車","oneWayFare":520,"roundTripFare":1040,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"},
        {"date":"10月27日","workType":"夜勤","clientName":"サンプル物流","siteName":"物流倉庫D","siteAddress":"サンプル県湾岸市13-14-15","nearestStation":"架空物流駅","route":"サンプル駅A ↔ 架空物流駅","transport":"電車","oneWayFare":370,"roundTripFare":740,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"}
      ]
    },
    {
      "id": "demo-sato",
      "name": "佐藤 一郎",
      "employeeCode": "000002",
      "address": "サンプル県ひかり市若葉4-5-6",
      "nearestStations": ["サンプル駅C"],
      "hankoName": "佐藤",
      "showDigitalHanko": true,
      "hankoScale": 1,
      "notes": "1人目と一部だけ異なる架空データです。",
      "entries": [
        {"date":"10月2日","workType":"日勤","clientName":"サンプル建設株式会社 首都圏事業部","siteName":"青葉通り共同庁舎新館工事A","siteAddress":"サンプル都中央区1-2-3","nearestStation":"サンプル中央駅","route":"サンプル駅C ↔ サンプル中央駅","transport":"電車","oneWayFare":350,"roundTripFare":700,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"},
        {"date":"10月5日","workType":"夜勤","clientName":"デモ設備","siteName":"駅前改修B","siteAddress":"サンプル都みどり区4-5-6","nearestStation":"テスト港駅","route":"サンプル駅C ↔ テスト港駅","transport":"電車","oneWayFare":440,"roundTripFare":880,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"},
        {"date":"10月12日","workType":"研修","clientName":"架空警備株式会社","siteName":"教育センター","siteAddress":"サンプル県学園市7-8-9","nearestStation":"研修センター前","route":"サンプル駅C ↔ 研修センター前","transport":"電車・バス","oneWayFare":300,"roundTripFare":600,"fareType":"IC","verificationUrl":"","memo":"架空のサンプル勤務"},
        {"date":"10月27日","workType":"夜勤","clientName":"サンプル物流","siteName":"物流倉庫D","siteAddress":"サンプル県湾岸市13-14-15","nearestStation":"架空物流駅","route":"サンプル駅C ↔ 架空物流駅","transport":"電車","oneWayFare":390,"roundTripFare":780,"fareType":"IC","verificationUrl":"","memo":"1人目と異なる勤務日の例"}
      ]
    }
  ]
};

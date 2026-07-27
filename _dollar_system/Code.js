/**
 * 달러 뱅크 시스템 - Google Apps Script 서버 측 로직
 */

// 스프레드시트 ID 저장 키
const SPREADSHEET_ID_KEY = 'DOLLAR_BANK_SPREADSHEET_ID';

// 스프레드시트 가져오기 함수 (자동 생성 포함)
function getSpreadsheet() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty(SPREADSHEET_ID_KEY);
  
  // 저장된 ID가 있으면 해당 스프레드시트 사용
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      // 스프레드시트를 찾을 수 없으면 ID 삭제하고 새로 생성
      properties.deleteProperty(SPREADSHEET_ID_KEY);
    }
  }
  
  // 연결된 스프레드시트가 있으면 사용
  try {
    const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (activeSpreadsheet) {
      // ID 저장
      properties.setProperty(SPREADSHEET_ID_KEY, activeSpreadsheet.getId());
      return activeSpreadsheet;
    }
  } catch (e) {
    // 연결된 스프레드시트가 없음
  }
  
  // 스프레드시트가 없으면 자동 생성
  const newSpreadsheet = SpreadsheetApp.create('Salt Academy Dollar Bank Data');
  spreadsheetId = newSpreadsheet.getId();
  properties.setProperty(SPREADSHEET_ID_KEY, spreadsheetId);
  
  return newSpreadsheet;
}

// 시트 이름 상수
const SHEET_NAMES = {
  STUDENTS: 'Students',
  TRANSACTIONS: 'Transactions',
  TEACHERS: 'Teachers',
  CLASSES: 'Classes'
};

// 역할 상수
const ROLES = {
  ADMIN: 'Admin',
  TEACHER: 'Teacher',
  STUDENT: 'Student'
};

/**
 * 웹 앱 진입점
 */
function doGet(e) {
  // 첫 실행 시 자동으로 스프레드시트 초기화
  try {
    initializeSheets();
  } catch (error) {
    // 초기화 실패해도 계속 진행
    console.log('초기화 오류 (무시됨):', error);
  }
  
  const template = HtmlService.createTemplateFromFile('Index');
  template.url = ScriptApp.getService().getUrl();
  return template.evaluate()
    .setTitle('Salt Academy Dollar Bank')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTML 파일 include 함수
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 초기화: 스프레드시트와 시트가 없으면 자동 생성
 */
function initializeSheets() {
  try {
    // 스프레드시트 가져오기 (없으면 자동 생성)
    const ss = getSpreadsheet();
    
    if (!ss) {
      return { success: false, message: 'Cannot create spreadsheet.' };
    }
    
    let createdSheets = [];
    
    // Students 시트 생성
    let studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    if (!studentsSheet) {
      studentsSheet = ss.insertSheet(SHEET_NAMES.STUDENTS);
      studentsSheet.appendRow(['StudentID', 'Name', 'ClassName', 'PinCode', 'Balance', 'TeacherID']);
      studentsSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
      createdSheets.push(SHEET_NAMES.STUDENTS);
    } else {
      // 기존 Students 시트에 TeacherID 컬럼이 없으면 추가
      const headers = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
      if (!headers.includes('TeacherID')) {
        const lastCol = studentsSheet.getLastColumn();
        studentsSheet.getRange(1, lastCol + 1).setValue('TeacherID');
        studentsSheet.getRange(1, lastCol + 1).setFontWeight('bold');
      }
    }
    
    // Transactions 시트 생성
    if (!ss.getSheetByName(SHEET_NAMES.TRANSACTIONS)) {
      const transactionsSheet = ss.insertSheet(SHEET_NAMES.TRANSACTIONS);
      transactionsSheet.appendRow(['Timestamp', 'StudentID', 'TeacherID', 'Amount', 'Reason']);
      transactionsSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      createdSheets.push(SHEET_NAMES.TRANSACTIONS);
    }
    
    // Teachers 시트 생성
    let isNewTeachersSheet = false;
    if (!ss.getSheetByName(SHEET_NAMES.TEACHERS)) {
      const teachersSheet = ss.insertSheet(SHEET_NAMES.TEACHERS);
      teachersSheet.appendRow(['TeacherID', 'Name', 'Password', 'Role', 'AssignedClasses']);
      teachersSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      createdSheets.push(SHEET_NAMES.TEACHERS);
      isNewTeachersSheet = true;
    }
    
    // Classes 시트 생성
    let classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (!classesSheet) {
      classesSheet = ss.insertSheet(SHEET_NAMES.CLASSES);
      classesSheet.appendRow(['ClassName', 'Order', 'TeacherID']);
      classesSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
      createdSheets.push(SHEET_NAMES.CLASSES);
    } else {
      // 기존 Classes 시트에 Order 컬럼이 없으면 추가
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      let hasOrder = headers.includes('Order');
      let hasTeacherID = headers.includes('TeacherID');
      
      if (!hasOrder) {
        const lastCol = classesSheet.getLastColumn();
        classesSheet.getRange(1, lastCol + 1).setValue('Order');
        classesSheet.getRange(1, lastCol + 1).setFontWeight('bold');
        // 기존 데이터에 Order 값 설정
        const data = classesSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          classesSheet.getRange(i + 1, lastCol + 1).setValue(i);
        }
      }
      
      if (!hasTeacherID) {
        const lastCol = classesSheet.getLastColumn();
        classesSheet.getRange(1, lastCol + 1).setValue('TeacherID');
        classesSheet.getRange(1, lastCol + 1).setFontWeight('bold');
      }
    }
    
    // 기본 Admin 계정 생성 (Teachers 시트가 새로 생성되었거나 데이터가 없을 때)
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    if (teachersSheet) {
      const data = teachersSheet.getDataRange().getValues();
      // 헤더만 있거나 데이터가 없으면 기본 계정 생성
      if (data.length <= 1 || isNewTeachersSheet) {
        // 기존 ADMIN001 계정이 있는지 확인
        let hasAdmin = false;
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === 'ADMIN001') {
            hasAdmin = true;
            break;
          }
        }
        if (!hasAdmin) {
          teachersSheet.appendRow(['ADMIN001', 'Admin', 'admin123', ROLES.ADMIN, 'ALL']);
        }
      }
    }
    
    // 기본 시트 삭제 (Sheet1이 있으면)
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && createdSheets.length > 0) {
      ss.deleteSheet(defaultSheet);
    }
    
    const spreadsheetUrl = ss.getUrl();
    const message = createdSheets.length > 0 
      ? `Spreadsheet created and sheets initialized.\nSpreadsheet URL: ${spreadsheetUrl}`
      : `Sheets are already initialized.\nSpreadsheet URL: ${spreadsheetUrl}`;
    
    return { 
      success: true, 
      message: message,
      spreadsheetUrl: spreadsheetUrl,
      spreadsheetId: ss.getId()
    };
  } catch (error) {
    return { 
      success: false, 
      message: '초기화 중 오류가 발생했습니다: ' + error.toString() 
    };
  }
}

/**
 * 교사 로그인 인증
 */
function authenticateTeacher(teacherID, password) {
  try {
    // 스프레드시트가 없으면 자동 생성 및 초기화
    let ss = getSpreadsheet();
    if (!ss) {
      initializeSheets();
      ss = getSpreadsheet();
      if (!ss) {
        return { success: false, message: 'Cannot create spreadsheet.' };
      }
    }
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    
    if (!teachersSheet) {
      return { success: false, message: 'Teachers sheet not found.' };
    }
    
    const data = teachersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === teacherID) {
        // 비밀번호 확인 (비밀번호가 'dummy'인 경우는 스킵 - 클래스 추가 후 재인증용)
        if (data[i][2] !== password && password !== 'dummy') {
          continue;
        }
        
        // assignedClasses 처리
        let assignedClasses = [];
        if (data[i][4]) {
          if (typeof data[i][4] === 'string') {
            assignedClasses = data[i][4].split(',').map(c => c.trim()).filter(c => c);
          } else if (Array.isArray(data[i][4])) {
            assignedClasses = data[i][4];
          }
        }
        
        return {
          success: true,
          teacher: {
            teacherID: data[i][0],
            name: data[i][1],
            role: data[i][3],
            assignedClasses: assignedClasses
          }
        };
      }
    }
    
      return { success: false, message: 'Invalid ID or password.' };
  } catch (error) {
      return { success: false, message: 'Login error: ' + error.toString() };
  }
}

/**
 * 학생 PIN 코드 인증
 */
function authenticateStudent(pinCode) {
  try {
    // 스프레드시트가 없으면 자동 생성 및 초기화
    let ss = getSpreadsheet();
    if (!ss) {
      initializeSheets();
      ss = getSpreadsheet();
      if (!ss) {
        return { success: false, message: 'Cannot create spreadsheet.' };
      }
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    
    Logger.log('authenticateStudent 호출:', { pinCode: pinCode, dataLength: data.length });
    
    for (let i = 1; i < data.length; i++) {
      // PIN 코드를 문자열로 변환하여 비교 (공백 제거)
      const rowPinCode = String(data[i][3] || '').trim();
      const searchPinCode = String(pinCode || '').trim();
      
      Logger.log('PIN 코드 비교:', { 
        row: i, 
        rowPinCode: rowPinCode, 
        searchPinCode: searchPinCode, 
        match: rowPinCode === searchPinCode 
      });
      
      if (rowPinCode === searchPinCode) {
        Logger.log('PIN 코드 일치, 학생 정보 반환:', data[i][0]);
        return {
          success: true,
          student: {
            studentID: data[i][0],
            name: data[i][1],
            className: data[i][2],
            pinCode: data[i][3],
            balance: data[i][4] || 0
          }
        };
      }
    }
    
    Logger.log('PIN 코드 일치하는 학생 없음');
    return { success: false, message: 'PIN code is incorrect.' };
  } catch (error) {
    Logger.log('authenticateStudent 오류: ' + error.toString());
    return { success: false, message: 'Authentication error: ' + error.toString() };
  }
}

/**
 * 학생 목록 조회 (교사용 - 할당된 반만)
 */
function getStudentsForTeacher(teacherID, assignedClasses) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    const students = [];
    
    for (let i = 1; i < data.length; i++) {
      const className = data[i][2];
      
      // Admin이거나 할당된 반에 포함된 경우
      if (assignedClasses.includes('ALL') || assignedClasses.includes(className)) {
        students.push({
          studentID: data[i][0],
          name: data[i][1],
          className: data[i][2],
          balance: data[i][4] || 0
        });
      }
    }
    
    return { success: true, students: students };
  } catch (error) {
      return { success: false, message: 'Error retrieving student list: ' + error.toString() };
  }
}

/**
 * 모든 학생 목록 조회 (Admin용)
 */
function getAllStudents() {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    const students = [];
    
    for (let i = 1; i < data.length; i++) {
      students.push({
        studentID: data[i][0],
        name: data[i][1],
        className: data[i][2],
        pinCode: data[i][3],
        balance: data[i][4] || 0
      });
    }
    
    return { success: true, students: students };
  } catch (error) {
      return { success: false, message: 'Error retrieving student list: ' + error.toString() };
  }
}

/**
 * 학생 정보 조회 (ID로)
 */
function getStudentByID(studentID) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === studentID) {
        return {
          success: true,
          student: {
            studentID: data[i][0],
            name: data[i][1],
            className: data[i][2],
            pinCode: data[i][3],
            balance: data[i][4] || 0
          }
        };
      }
    }
    
    return { success: false, message: 'Student not found.' };
  } catch (error) {
      return { success: false, message: 'Error retrieving student information: ' + error.toString() };
  }
}

/**
 * 거래 내역 조회 (학생용)
 */
function getStudentTransactions(studentID) {
  try {
    // 입력 검증
    if (!studentID || studentID === '') {
      return { success: false, message: 'Student ID is required.', transactions: [] };
    }
    
    Logger.log('getStudentTransactions 호출:', { studentID: studentID });
    
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.', transactions: [] };
    }
    
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    if (!transactionsSheet) {
      Logger.log('Transactions 시트를 찾을 수 없음, 초기화 시도');
      // Transactions 시트가 없으면 초기화 시도
      initializeSheets();
      const newTransactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
      if (!newTransactionsSheet) {
        return { success: false, message: 'Transactions sheet not found.', transactions: [] };
      }
      // 빈 배열 반환 (시트는 생성되었지만 데이터 없음)
      return { success: true, transactions: [] };
    }
    
    const data = transactionsSheet.getDataRange().getValues();
    Logger.log('Transactions 시트 데이터:', { rows: data.length });
    
    const transactions = [];
    
    // 헤더 행 제외하고 데이터 처리
    for (let i = 1; i < data.length; i++) {
      if (!data[i] || data[i].length < 2) continue;
      
      // StudentID가 일치하는 경우 (문자열 비교)
      const rowStudentID = String(data[i][1] || '').trim();
      const searchStudentID = String(studentID).trim();
      
      if (rowStudentID === searchStudentID) {
        // timestamp를 문자열로 변환 (Date 객체는 직렬화 문제 발생 가능)
        let timestampStr = null;
        try {
          if (data[i][0]) {
            if (data[i][0] instanceof Date) {
              timestampStr = data[i][0].toISOString();
            } else {
              timestampStr = String(data[i][0]);
            }
          }
        } catch (e) {
          Logger.log('timestamp 변환 오류: ' + e.toString());
          timestampStr = null;
        }
        
        const transaction = {
          timestamp: timestampStr,
          teacherID: String(data[i][2] || ''),
          amount: parseFloat(data[i][3]) || 0,
          reason: String(data[i][4] || '')
        };
        transactions.push(transaction);
      }
    }
    
    Logger.log('찾은 거래 내역 개수:', transactions.length);
    
    // 최신순 정렬
    if (transactions.length > 0) {
      transactions.sort(function(a, b) {
        try {
          if (!a.timestamp || !b.timestamp) return 0;
          const dateA = new Date(a.timestamp);
          const dateB = new Date(b.timestamp);
          if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) return 0;
          return dateB.getTime() - dateA.getTime();
        } catch (e) {
          return 0;
        }
      });
    }
    
    // 항상 객체 반환 (null이 아닌 빈 배열이라도)
    // JSON 직렬화 가능한 형태로 변환
    const result = { 
      success: true, 
      transactions: (transactions || []).map(function(t) {
        return {
          timestamp: t.timestamp,
          teacherID: String(t.teacherID || ''),
          amount: Number(t.amount || 0),
          reason: String(t.reason || '')
        };
      })
    };
    
    Logger.log('getStudentTransactions 결과:', { 
      success: result.success, 
      count: result.transactions.length,
      studentID: studentID
    });
    
    // JSON 직렬화 테스트
    try {
      const testJson = JSON.stringify(result);
      Logger.log('JSON 직렬화 성공, 길이:', testJson.length);
      return JSON.parse(testJson); // 직렬화 후 파싱하여 안전한 객체 반환
    } catch (jsonError) {
      Logger.log('JSON 직렬화 실패: ' + jsonError.toString());
      // 직렬화 실패 시 최소한의 응답 반환
      return {
        success: true,
        transactions: []
      };
    }
  } catch (error) {
    Logger.log('getStudentTransactions 오류: ' + error.toString());
    Logger.log('오류 스택:', error.stack);
    
    // 에러가 발생해도 항상 올바른 형식의 객체 반환
    try {
    return { 
      success: false, 
        message: 'Error retrieving transaction history: ' + error.toString(),
      transactions: []
    };
    } catch (returnError) {
      // 심지어 반환도 실패하면 빈 객체라도 반환
      return JSON.parse('{"success":false,"message":"Critical error","transactions":[]}');
    }
  }
}

/**
 * 입출금 처리
 */
function processTransaction(studentID, teacherID, amount, reason) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    
    if (!studentsSheet || !transactionsSheet) {
      return { success: false, message: 'Sheet not found.' };
    }
    
    // 학생 정보 찾기
    const studentsData = studentsSheet.getDataRange().getValues();
    let studentRow = -1;
    let currentBalance = 0;
    
    for (let i = 1; i < studentsData.length; i++) {
      if (studentsData[i][0] === studentID) {
        studentRow = i + 1;
        currentBalance = studentsData[i][4] || 0;
        break;
      }
    }
    
    if (studentRow === -1) {
      return { success: false, message: 'Student not found.' };
    }
    
    // 잔액 업데이트
    const newBalance = currentBalance + amount;
    if (newBalance < 0) {
      return { success: false, message: 'Insufficient balance.' };
    }
    
    studentsSheet.getRange(studentRow, 5).setValue(newBalance);
    
    // 거래 내역 기록
    const timestamp = new Date();
    transactionsSheet.appendRow([timestamp, studentID, teacherID, amount, reason]);
    
    return {
      success: true,
      message: 'Transaction completed successfully.',
      newBalance: newBalance
    };
  } catch (error) {
      return { success: false, message: 'Error processing transaction: ' + error.toString() };
  }
}

/**
 * 학생 추가 (Admin용)
 */
function addStudent(studentID, name, className, pinCode, teacherID) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    // 중복 확인
    const data = studentsSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === studentID || data[i][3] === pinCode) {
        return { success: false, message: 'Student ID or PIN code already exists.' };
      }
    }
    
    // TeacherID 컬럼 위치 확인
    const headers = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
    const teacherIDColIndex = headers.indexOf('TeacherID');
    
    // 클래스가 Classes 시트에 없으면 자동 추가
    if (teacherID) {
      addClass(className, teacherID);
    }
    
    // 학생 추가 (TeacherID 포함)
    if (teacherIDColIndex >= 0) {
      studentsSheet.appendRow([studentID, name, className, pinCode, 0, teacherID || '']);
    } else {
    studentsSheet.appendRow([studentID, name, className, pinCode, 0]);
    }
    
      return { success: true, message: 'Student added successfully.' };
  } catch (error) {
      return { success: false, message: 'Error adding student: ' + error.toString() };
  }
}

/**
 * 학생 수정 (Admin용)
 */
function updateStudent(studentID, name, className, pinCode, balance) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === studentID) {
        studentsSheet.getRange(i + 1, 2).setValue(name);
        studentsSheet.getRange(i + 1, 3).setValue(className);
        studentsSheet.getRange(i + 1, 4).setValue(pinCode);
        studentsSheet.getRange(i + 1, 5).setValue(balance);
        
        return { success: true, message: 'Student information updated successfully.' };
      }
    }
    
    return { success: false, message: 'Student not found.' };
  } catch (error) {
      return { success: false, message: 'Error updating student: ' + error.toString() };
  }
}

/**
 * 학생 삭제 (Admin용)
 */
function deleteStudent(studentID) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    const data = studentsSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === studentID) {
        studentsSheet.deleteRow(i + 1);
        return { success: true, message: 'Student deleted successfully.' };
      }
    }
    
    return { success: false, message: 'Student not found.' };
  } catch (error) {
      return { success: false, message: 'Error deleting student: ' + error.toString() };
  }
}

/**
 * 교사 목록 조회 (Admin용)
 */
function getAllTeachers() {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    
    if (!teachersSheet) {
      return { success: false, message: 'Teachers sheet not found.' };
    }
    
    const data = teachersSheet.getDataRange().getValues();
    const teachers = [];
    
    for (let i = 1; i < data.length; i++) {
      teachers.push({
        teacherID: data[i][0],
        name: data[i][1],
        role: data[i][3],
        assignedClasses: data[i][4] || ''
      });
    }
    
    return { success: true, teachers: teachers };
  } catch (error) {
      return { success: false, message: 'Error retrieving teacher list: ' + error.toString() };
  }
}

/**
 * 교사 추가 (Admin용)
 */
function addTeacher(teacherID, name, password, role, assignedClasses) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    
    if (!teachersSheet) {
      return { success: false, message: 'Teachers sheet not found.' };
    }
    
    // 중복 확인
    const data = teachersSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === teacherID) {
        return { success: false, message: 'Teacher ID already exists.' };
      }
    }
    
    teachersSheet.appendRow([teacherID, name, password, role, assignedClasses]);
    
      return { success: true, message: 'Teacher added successfully.' };
  } catch (error) {
      return { success: false, message: 'Error adding teacher: ' + error.toString() };
  }
}

/**
 * 교사 수정 (Admin용)
 */
function updateTeacher(teacherID, name, password, role, assignedClasses) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    
    if (!teachersSheet) {
      return { success: false, message: 'Teachers sheet not found.' };
    }
    
    const data = teachersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === teacherID) {
        // 비밀번호가 비어있으면 기존 비밀번호 유지
        const newPassword = password ? password : data[i][2];
        
        teachersSheet.getRange(i + 1, 2).setValue(name);
        teachersSheet.getRange(i + 1, 3).setValue(newPassword);
        teachersSheet.getRange(i + 1, 4).setValue(role);
        teachersSheet.getRange(i + 1, 5).setValue(assignedClasses);
        
        return { success: true, message: 'Teacher information updated successfully.' };
      }
    }
    
      return { success: false, message: 'Teacher not found.' };
  } catch (error) {
      return { success: false, message: 'Error updating teacher: ' + error.toString() };
  }
}

/**
 * 교사 삭제 (Admin용)
 */
function deleteTeacher(teacherID) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    
    if (!teachersSheet) {
      return { success: false, message: 'Teachers sheet not found.' };
    }
    
    const data = teachersSheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === teacherID) {
        // 자기 자신은 삭제 불가
        if (data[i][3] === ROLES.ADMIN) {
          return { success: false, message: 'Admin account cannot be deleted.' };
        }
        teachersSheet.deleteRow(i + 1);
        return { success: true, message: 'Teacher deleted successfully.' };
      }
    }
    
      return { success: false, message: 'Teacher not found.' };
  } catch (error) {
      return { success: false, message: 'Error deleting teacher: ' + error.toString() };
  }
}

/**
 * 클래스 추가
 */
function addClass(className, teacherID) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    
    // Classes 시트 가져오기 또는 생성
    let classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (!classesSheet) {
      classesSheet = ss.insertSheet(SHEET_NAMES.CLASSES);
      classesSheet.appendRow(['ClassName', 'Order']);
      classesSheet.getRange(1, 1, 1, 2).setFontWeight('bold');
    } else {
      // Order 컬럼이 없으면 추가
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      if (!headers.includes('Order')) {
        const lastCol = classesSheet.getLastColumn();
        classesSheet.getRange(1, lastCol + 1).setValue('Order');
        classesSheet.getRange(1, lastCol + 1).setFontWeight('bold');
        // 기존 데이터에 Order 값 설정
        const existingData = classesSheet.getDataRange().getValues();
        for (let i = 1; i < existingData.length; i++) {
          classesSheet.getRange(i + 1, lastCol + 1).setValue(i);
        }
      }
    }
    
    // 중복 확인 및 최대 Order 찾기
    const data = classesSheet.getDataRange().getValues();
    let classExists = false;
    let maxOrder = 0;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(className).trim()) {
        classExists = true;
        break;
      }
      // 최대 Order 값 찾기
      const order = data[i][1] ? Number(data[i][1]) : i;
      if (order > maxOrder) {
        maxOrder = order;
      }
    }
    
    // 클래스가 없으면 추가
    if (!classExists) {
      // 새 클래스는 마지막 순서로 추가
      const newOrder = maxOrder + 1;
      // TeacherID 컬럼 위치 확인
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID');
      const orderColIndex = headers.indexOf('Order');
      
      // 컬럼 순서에 맞게 데이터 배열 생성
      const row = [];
      row[0] = className.trim();
      if (orderColIndex >= 0) {
        row[orderColIndex] = newOrder;
      }
      if (teacherIDColIndex >= 0 && teacherID) {
        row[teacherIDColIndex] = teacherID;
      }
      
      // 빈 값 제거하고 추가
      const finalRow = row.filter((val, idx) => idx === 0 || val !== undefined);
      classesSheet.appendRow(finalRow);
    }
    
    // 교사가 클래스를 추가한 경우, 해당 교사의 할당 클래스 목록에 자동 추가
    if (teacherID) {
      const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
      if (teachersSheet) {
        const teachersData = teachersSheet.getDataRange().getValues();
        for (let i = 1; i < teachersData.length; i++) {
          if (teachersData[i][0] === teacherID) {
            let assignedClasses = teachersData[i][4] || '';
    let classesArray = [];
            
            if (assignedClasses) {
              if (typeof assignedClasses === 'string') {
                classesArray = assignedClasses.split(',').map(c => c.trim()).filter(c => c);
              } else if (Array.isArray(assignedClasses)) {
      classesArray = assignedClasses;
              }
            }
            
            // ALL이 아니고, 클래스가 목록에 없으면 추가
            if (!classesArray.includes('ALL') && !classesArray.includes(className.trim())) {
              classesArray.push(className.trim());
              teachersSheet.getRange(i + 1, 5).setValue(classesArray.join(','));
              Logger.log('교사 할당 클래스 목록 업데이트:', teacherID, classesArray);
            }
            break;
          }
        }
      }
    }
    
    return { success: true, message: 'Class added successfully.' };
  } catch (error) {
    Logger.log('addClass 오류: ' + error.toString());
    return { success: false, message: 'Error adding class: ' + error.toString() };
  }
}

/**
 * 반 목록 조회 (교사용) - Classes 시트와 Students 시트 모두에서 가져오기
 */
function getClassesForTeacher(teacherID, assignedClasses) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    
    // 마이그레이션 강제 실행 (누락된 데이터 처리)
    migrateExistingDataToIanPark(ss);
    
    // 교사 역할 확인
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    let isAdmin = false;
    if (teachersSheet) {
      const teachersData = teachersSheet.getDataRange().getValues();
      for (let i = 1; i < teachersData.length; i++) {
        if (teachersData[i][0] === teacherID) {
          isAdmin = (teachersData[i][3] === ROLES.ADMIN);
          break;
        }
      }
    }
    
    const classSet = new Set();
    
    // Classes 시트에서 클래스 가져오기
    const classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (classesSheet) {
      const classesData = classesSheet.getDataRange().getValues();
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID');
      
      Logger.log('getClassesForTeacher - Classes 시트 조회:', {
        teacherID: teacherID,
        isAdmin: isAdmin,
        teacherIDColIndex: teacherIDColIndex,
        totalRows: classesData.length,
        headers: headers
      });
      
      for (let i = 1; i < classesData.length; i++) {
        const className = String(classesData[i][0] || '').trim();
        if (className && className !== '') {
          // Admin은 모든 클래스 보기, 일반 교사는 자신이 만든 클래스만
          if (isAdmin) {
            classSet.add(className);
            Logger.log('Admin - 클래스 추가:', className);
          } else if (teacherIDColIndex >= 0) {
            const classTeacherID = String(classesData[i][teacherIDColIndex] || '').trim();
            Logger.log('클래스 TeacherID 비교:', {
              className: className,
              classTeacherID: classTeacherID,
              teacherID: teacherID,
              match: classTeacherID === teacherID,
              rowIndex: i
            });
            // TeacherID가 일치하거나 비어있으면 (마이그레이션 전 데이터) 표시
            if (classTeacherID === teacherID || (!classTeacherID && teacherID === 'ianpark')) {
              classSet.add(className);
              Logger.log('일반 교사 - 클래스 추가:', className);
              // TeacherID가 비어있으면 자동으로 할당
              if (!classTeacherID && teacherID === 'ianpark') {
                classesSheet.getRange(i + 1, teacherIDColIndex + 1).setValue(teacherID);
                Logger.log('TeacherID 자동 할당:', className, '->', teacherID);
              }
            }
          } else {
            // TeacherID 컬럼이 없으면 모든 클래스 표시 (기존 데이터 호환성)
            classSet.add(className);
            Logger.log('TeacherID 컬럼 없음 - 클래스 추가:', className);
          }
        }
      }
    }
    
    // Order로 정렬
    const classesWithOrder = [];
    if (classesSheet) {
      const classesData = classesSheet.getDataRange().getValues();
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      const orderColIndex = headers.indexOf('Order');
      const teacherIDColIndex = headers.indexOf('TeacherID');
      
      for (let i = 1; i < classesData.length; i++) {
        const className = String(classesData[i][0] || '').trim();
        if (className && classSet.has(className)) {
          const order = orderColIndex >= 0 && classesData[i][orderColIndex] ? Number(classesData[i][orderColIndex]) : i;
          classesWithOrder.push({ className: className, order: order });
        }
      }
      
      classesWithOrder.sort(function(a, b) {
        return a.order - b.order;
      });
    }
    
    const classes = classesWithOrder.map(item => item.className);
    
    Logger.log('getClassesForTeacher 반환:', { 
      teacherID: teacherID, 
      isAdmin: isAdmin,
      classes: classes
    });
    
    return { success: true, classes: classes };
  } catch (error) {
    Logger.log('getClassesForTeacher 오류: ' + error.toString());
      return { success: false, message: 'Error retrieving class list: ' + error.toString() };
  }
}

/**
 * 특정 반의 학생 목록 조회
 */
function getStudentsByClass(className, teacherID, assignedClasses) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!studentsSheet) {
      return { success: false, message: 'Students sheet not found.' };
    }
    
    // 교사 역할 확인
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    let isAdmin = false;
    if (teachersSheet) {
      const teachersData = teachersSheet.getDataRange().getValues();
      for (let i = 1; i < teachersData.length; i++) {
        if (teachersData[i][0] === teacherID) {
          isAdmin = (teachersData[i][3] === ROLES.ADMIN);
          break;
        }
      }
    }
    
    // 클래스 소유권 확인 (Admin이 아닌 경우)
    if (!isAdmin) {
      const classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
      let hasAccess = false;
      
      if (classesSheet) {
        const classesData = classesSheet.getDataRange().getValues();
        const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
        const teacherIDColIndex = headers.indexOf('TeacherID');
        
        for (let i = 1; i < classesData.length; i++) {
          if (String(classesData[i][0] || '').trim() === className) {
            if (teacherIDColIndex >= 0) {
              const classTeacherID = String(classesData[i][teacherIDColIndex] || '').trim();
              if (classTeacherID === teacherID) {
                hasAccess = true;
                break;
              }
            }
            break;
          }
        }
      }
      
      // 클래스의 TeacherID가 일치하지 않거나 없으면, 학생의 TeacherID로 확인
      if (!hasAccess) {
        const studentsData = studentsSheet.getDataRange().getValues();
        const studentsHeaders = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
        const studentTeacherIDColIndex = studentsHeaders.indexOf('TeacherID');
        
        if (studentTeacherIDColIndex >= 0) {
          for (let i = 1; i < studentsData.length; i++) {
            if (String(studentsData[i][2] || '').trim() === className) {
              const studentTeacherID = String(studentsData[i][studentTeacherIDColIndex] || '').trim();
              // 학생의 TeacherID가 일치하거나 비어있으면 접근 허용 (기존 데이터 호환성)
              if (studentTeacherID === teacherID || !studentTeacherID) {
                hasAccess = true;
                // 학생의 TeacherID가 비어있으면 자동으로 설정
                if (!studentTeacherID) {
                  studentsSheet.getRange(i + 1, studentTeacherIDColIndex + 1).setValue(teacherID);
                  Logger.log('학생 TeacherID 자동 설정:', studentsData[i][0], '->', teacherID);
                }
                // 클래스의 TeacherID가 비어있으면 자동으로 설정
                if (classesSheet) {
                  const classesData = classesSheet.getDataRange().getValues();
                  const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
                  const teacherIDColIndex = headers.indexOf('TeacherID');
                  if (teacherIDColIndex >= 0) {
                    for (let j = 1; j < classesData.length; j++) {
                      if (String(classesData[j][0] || '').trim() === className) {
                        const classTeacherID = String(classesData[j][teacherIDColIndex] || '').trim();
                        if (!classTeacherID || classTeacherID === '') {
                          classesSheet.getRange(j + 1, teacherIDColIndex + 1).setValue(teacherID);
                          Logger.log('클래스 TeacherID 자동 설정:', className, '->', teacherID);
                        }
                        break;
                      }
                    }
                  }
                }
                break; // 첫 번째 일치하는 학생을 찾으면 중단
              }
            }
          }
        }
      }
      
      if (!hasAccess) {
        return { success: false, message: 'Access denied.' };
      }
    }
    
    const data = studentsSheet.getDataRange().getValues();
    const headers = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
    const teacherIDColIndex = headers.indexOf('TeacherID');
    const students = [];
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][2] || '').trim() === className) {
        // Admin은 모든 학생 보기, 일반 교사는 자신이 담당하는 학생만
        if (isAdmin) {
          students.push({
            studentID: data[i][0],
            name: data[i][1],
            className: data[i][2],
            balance: data[i][4] || 0
          });
        } else if (teacherIDColIndex >= 0) {
          const studentTeacherID = String(data[i][teacherIDColIndex] || '').trim();
          // 접근이 허용된 경우, TeacherID가 일치하거나 비어있으면 학생 포함
          if (studentTeacherID === teacherID || !studentTeacherID) {
            students.push({
              studentID: data[i][0],
              name: data[i][1],
              className: data[i][2],
              balance: data[i][4] || 0
            });
          }
        } else {
          // TeacherID 컬럼이 없으면 모든 학생 포함 (기존 데이터 호환성)
          students.push({
            studentID: data[i][0],
            name: data[i][1],
            className: data[i][2],
            balance: data[i][4] || 0
          });
        }
      }
    }
    
    return { success: true, students: students };
  } catch (error) {
      return { success: false, message: 'Error retrieving student list: ' + error.toString() };
  }
}

/**
 * 거래 내역 수정
 */
function updateTransaction(studentID, transactionIndex, newAmount, newReason) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!transactionsSheet || !studentsSheet) {
      return { success: false, message: 'Sheet not found.' };
    }
    
    // 해당 학생의 모든 거래 내역 찾기
    const data = transactionsSheet.getDataRange().getValues();
    const studentTransactions = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === studentID) {
        studentTransactions.push({
          row: i + 1,
          timestamp: data[i][0],
          amount: data[i][3],
          reason: data[i][4]
        });
      }
    }
    
    // 최신순 정렬
    studentTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (transactionIndex < 0 || transactionIndex >= studentTransactions.length) {
      return { success: false, message: 'Transaction not found.' };
    }
    
    const targetTransaction = studentTransactions[transactionIndex];
    const oldAmount = targetTransaction.amount;
    const amountDiff = newAmount - oldAmount;
    
    // 거래 내역 수정
    transactionsSheet.getRange(targetTransaction.row, 4).setValue(newAmount);
    transactionsSheet.getRange(targetTransaction.row, 5).setValue(newReason);
    
    // 학생 잔액 업데이트
    const studentsData = studentsSheet.getDataRange().getValues();
    for (let i = 1; i < studentsData.length; i++) {
      if (studentsData[i][0] === studentID) {
        const currentBalance = studentsData[i][4] || 0;
        const newBalance = currentBalance + amountDiff;
        if (newBalance < 0) {
          return { success: false, message: 'Insufficient balance.' };
        }
        studentsSheet.getRange(i + 1, 5).setValue(newBalance);
        return { 
          success: true, 
          message: 'Transaction updated successfully.',
          newBalance: newBalance
        };
      }
    }
    
    return { success: false, message: 'Student not found.' };
  } catch (error) {
      return { success: false, message: 'Error updating transaction: ' + error.toString() };
  }
}

/**
 * 거래 내역 삭제
 */
function deleteTransaction(studentID, transactionIndex) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    const transactionsSheet = ss.getSheetByName(SHEET_NAMES.TRANSACTIONS);
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    
    if (!transactionsSheet || !studentsSheet) {
      return { success: false, message: 'Sheet not found.' };
    }
    
    // 해당 학생의 모든 거래 내역 찾기
    const data = transactionsSheet.getDataRange().getValues();
    const studentTransactions = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === studentID) {
        studentTransactions.push({
          row: i + 1,
          timestamp: data[i][0],
          amount: data[i][3]
        });
      }
    }
    
    // 최신순 정렬
    studentTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    if (transactionIndex < 0 || transactionIndex >= studentTransactions.length) {
      return { success: false, message: 'Transaction not found.' };
    }
    
    const targetTransaction = studentTransactions[transactionIndex];
    const amountToReverse = -targetTransaction.amount; // 반대 금액
    
    // 거래 내역 삭제
    transactionsSheet.deleteRow(targetTransaction.row);
    
    // 학생 잔액 업데이트 (거래 금액만큼 되돌림)
    const studentsData = studentsSheet.getDataRange().getValues();
    for (let i = 1; i < studentsData.length; i++) {
      if (studentsData[i][0] === studentID) {
        const currentBalance = studentsData[i][4] || 0;
        const newBalance = currentBalance + amountToReverse;
        if (newBalance < 0) {
          return { success: false, message: 'Insufficient balance.' };
        }
        studentsSheet.getRange(i + 1, 5).setValue(newBalance);
        return { 
          success: true, 
          message: 'Transaction deleted successfully.',
          newBalance: newBalance
        };
      }
    }
    
    return { success: false, message: 'Student not found.' };
  } catch (error) {
      return { success: false, message: 'Error deleting transaction: ' + error.toString() };
  }
}

/**
 * 클래스 순서 업데이트
 */
function updateClassOrder(classNames) {
  try {
    const ss = getSpreadsheet();
    if (!ss) {
      return { success: false, message: 'Spreadsheet not found.' };
    }
    
    const classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (!classesSheet) {
      return { success: false, message: 'Classes sheet not found.' };
    }
    
    const data = classesSheet.getDataRange().getValues();
    
    // 클래스 이름과 행 번호 매핑
    const classNameToRow = {};
    for (let i = 1; i < data.length; i++) {
      const className = String(data[i][0] || '').trim();
      if (className) {
        classNameToRow[className] = i + 1;
      }
    }
    
    // 새로운 순서로 Order 업데이트
    for (let order = 0; order < classNames.length; order++) {
      const className = classNames[order];
      const row = classNameToRow[className];
      if (row) {
        // Order 컬럼이 2번째 컬럼 (인덱스 1)
        classesSheet.getRange(row, 2).setValue(order + 1);
      }
    }
    
    return { success: true, message: 'Class order updated successfully.' };
  } catch (error) {
    Logger.log('updateClassOrder 오류: ' + error.toString());
    return { success: false, message: 'Error updating class order: ' + error.toString() };
  }
}

/**
 * 기존 데이터 마이그레이션 - 모든 클래스와 학생을 "Ian Park" 교사에게 할당
 */
function migrateExistingDataToIanPark(ss) {
  try {
    // "Ian Park" 교사 ID 찾기
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    if (!teachersSheet) return;
    
    const teachersData = teachersSheet.getDataRange().getValues();
    let ianParkTeacherID = null;
    
    for (let i = 1; i < teachersData.length; i++) {
      const teacherName = String(teachersData[i][1] || '').trim();
      if (teacherName === 'Ian Park' || teacherName === 'ianpark') {
        ianParkTeacherID = teachersData[i][0];
        break;
      }
    }
    
    // "Ian Park" 교사가 없으면 teacherID로 찾기
    if (!ianParkTeacherID) {
      for (let i = 1; i < teachersData.length; i++) {
        const teacherID = String(teachersData[i][0] || '').trim();
        if (teacherID === 'ianpark' || teacherID.toLowerCase() === 'ianpark') {
          ianParkTeacherID = teacherID;
          break;
        }
      }
    }
    
    if (!ianParkTeacherID) {
      Logger.log('Ian Park 교사를 찾을 수 없습니다. 마이그레이션 건너뜀.');
      return;
    }
    
    Logger.log('Ian Park 교사 ID:', ianParkTeacherID);
    
    // Classes 시트 마이그레이션
    const classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (classesSheet) {
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID') + 1;
      
      if (teacherIDColIndex > 0) {
        const data = classesSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const currentTeacherID = String(data[i][teacherIDColIndex - 1] || '').trim();
          if (!currentTeacherID || currentTeacherID === '') {
            classesSheet.getRange(i + 1, teacherIDColIndex).setValue(ianParkTeacherID);
            Logger.log('클래스 마이그레이션:', data[i][0], '->', ianParkTeacherID);
          }
        }
      }
    }
    
    // Students 시트 마이그레이션
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    if (studentsSheet) {
      const headers = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID') + 1;
      
      if (teacherIDColIndex > 0) {
        const data = studentsSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const currentTeacherID = String(data[i][teacherIDColIndex - 1] || '').trim();
          if (!currentTeacherID || currentTeacherID === '') {
            studentsSheet.getRange(i + 1, teacherIDColIndex).setValue(ianParkTeacherID);
            Logger.log('학생 마이그레이션:', data[i][0], '->', ianParkTeacherID);
          }
        }
      }
    }
    
    Logger.log('데이터 마이그레이션 완료');
  } catch (error) {
    Logger.log('마이그레이션 오류: ' + error.toString());
  }
}

/**
 * 기존 데이터 마이그레이션 - 모든 클래스와 학생을 "Ian Park" 교사에게 할당
 */
function migrateExistingDataToIanPark(ss) {
  try {
    // "Ian Park" 교사 ID 찾기
    const teachersSheet = ss.getSheetByName(SHEET_NAMES.TEACHERS);
    if (!teachersSheet) return;
    
    const teachersData = teachersSheet.getDataRange().getValues();
    let ianParkTeacherID = null;
    
    for (let i = 1; i < teachersData.length; i++) {
      const teacherName = String(teachersData[i][1] || '').trim();
      if (teacherName === 'Ian Park' || teacherName === 'ianpark') {
        ianParkTeacherID = teachersData[i][0];
        break;
      }
    }
    
    // "Ian Park" 교사가 없으면 teacherID로 찾기
    if (!ianParkTeacherID) {
      for (let i = 1; i < teachersData.length; i++) {
        const teacherID = String(teachersData[i][0] || '').trim();
        if (teacherID === 'ianpark' || teacherID.toLowerCase() === 'ianpark') {
          ianParkTeacherID = teacherID;
          break;
        }
      }
    }
    
    if (!ianParkTeacherID) {
      Logger.log('Ian Park 교사를 찾을 수 없습니다. 마이그레이션 건너뜀.');
      return;
    }
    
    Logger.log('Ian Park 교사 ID:', ianParkTeacherID);
    
    // Classes 시트 마이그레이션
    const classesSheet = ss.getSheetByName(SHEET_NAMES.CLASSES);
    if (classesSheet) {
      const headers = classesSheet.getRange(1, 1, 1, classesSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID') + 1;
      
      if (teacherIDColIndex > 0) {
        const data = classesSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const currentTeacherID = String(data[i][teacherIDColIndex - 1] || '').trim();
          if (!currentTeacherID || currentTeacherID === '') {
            classesSheet.getRange(i + 1, teacherIDColIndex).setValue(ianParkTeacherID);
            Logger.log('클래스 마이그레이션:', data[i][0], '->', ianParkTeacherID);
          }
        }
      }
    }
    
    // Students 시트 마이그레이션
    const studentsSheet = ss.getSheetByName(SHEET_NAMES.STUDENTS);
    if (studentsSheet) {
      const headers = studentsSheet.getRange(1, 1, 1, studentsSheet.getLastColumn()).getValues()[0];
      const teacherIDColIndex = headers.indexOf('TeacherID') + 1;
      
      if (teacherIDColIndex > 0) {
        const data = studentsSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          const currentTeacherID = String(data[i][teacherIDColIndex - 1] || '').trim();
          if (!currentTeacherID || currentTeacherID === '') {
            studentsSheet.getRange(i + 1, teacherIDColIndex).setValue(ianParkTeacherID);
            Logger.log('학생 마이그레이션:', data[i][0], '->', ianParkTeacherID);
          }
        }
      }
    }
    
    Logger.log('데이터 마이그레이션 완료');
  } catch (error) {
    Logger.log('마이그레이션 오류: ' + error.toString());
  }
}

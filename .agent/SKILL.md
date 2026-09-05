---
name: faos-documentation-architect
description: Thiết kế, xây dựng và cập nhật bộ tài liệu hệ thống end-to-end cho các hệ thống Agentic AI (như FAOS). Sử dụng khi cần tạo tài liệu kiến trúc, hướng dẫn triển khai Agent, đặc tả API và quy trình quản trị cho các dự án AI tự động hóa doanh nghiệp.
license: Complete terms in LICENSE.txt
---

# Skill: FAOS Documentation Architect

Kỹ năng này cung cấp khả năng thiết kế, xây dựng và cập nhật bộ tài liệu hệ thống end-to-end cho các hệ thống Agentic AI, đặc biệt là các hệ thống như FAOS (Federated Agent Operating System). Nó giúp chuẩn hóa quy trình tạo tài liệu kiến trúc, hướng dẫn triển khai Agent, đặc tả API và quy trình quản trị, đảm bảo tính chính xác và sát với thực tế vận hành.

## Khi nào sử dụng kỹ năng này?

Sử dụng kỹ năng này khi bạn cần:

*   **Thiết kế tài liệu hệ thống mới:** Bắt đầu một dự án Agentic AI và cần xây dựng bộ tài liệu từ đầu.
*   **Cập nhật tài liệu hiện có:** Điều chỉnh, bổ sung hoặc tối ưu hóa tài liệu hệ thống dựa trên thông tin thực tế hoặc các thay đổi trong kiến trúc/vận hành.
*   **Đảm bảo tính chính xác:** Đối soát tài liệu với các nguồn thông tin kỹ thuật thực tế (ví dụ: file PDF mô tả hệ thống) để đảm bảo tài liệu phản ánh đúng 100% những gì đang chạy.

## Quy trình sử dụng

Kỹ năng này hướng dẫn bạn qua các bước chính để tạo và cập nhật bộ tài liệu hệ thống FAOS:

1.  **Phân tích bối cảnh và yêu cầu:** Thu thập thông tin ban đầu về dự án, bao gồm mục tiêu, vấn đề cần giải quyết, quy mô doanh nghiệp và kiến trúc kỹ thuật tổng thể.

2.  **Xây dựng bản thảo tài liệu:** Sử dụng các template có sẵn để tạo bản thảo cho từng phần của bộ tài liệu:
    *   **Kiến trúc Hệ thống:** Sử dụng `templates/system_architecture_template.md` để phác thảo kiến trúc 5 lớp (Data, Orchestration, AI Agent, Execution, Governance).
    *   **Triển khai AI Agent & Workflow:** Sử dụng `templates/agent_implementation_template.md` để mô tả chi tiết từng AI Agent và luồng công việc của chúng.
    *   **Thiết kế Tích hợp & Đặc tả API:** Sử dụng `templates/api_spec_template.md` để định nghĩa các điểm tích hợp nội bộ và bên ngoài.
    *   **Vận hành & Quản trị:** Sử dụng `templates/ops_governance_template.md` để xây dựng các quy trình giám sát, quản lý sự cố, bảo mật và tuân thủ.

3.  **Đối soát và cập nhật với thực tế (nếu có):** Nếu có tài liệu mô tả hệ thống thực tế (ví dụ: file PDF từ đội ngũ kỹ thuật), hãy đọc và phân tích kỹ lưỡng. Sử dụng `references/real_world_alignment_checklist.md` để đảm bảo mọi chi tiết trong tài liệu đã tạo khớp chính xác với hệ thống đang vận hành. Thực hiện các chỉnh sửa cần thiết để tài liệu phản ánh đúng 100% thực tế.

4.  **Tổng hợp và hoàn thiện:** Tạo một tài liệu tổng hợp (Master Documentation) để liên kết tất cả các phần lại với nhau, cung cấp cái nhìn tổng quan và dễ dàng tra cứu.

## Tài nguyên đi kèm

Kỹ năng này bao gồm các tài nguyên sau:

*   **`templates/`**
    *   `system_architecture_template.md`: Mẫu cho tài liệu kiến trúc hệ thống.
    *   `agent_implementation_template.md`: Mẫu cho tài liệu triển khai AI Agent và workflow.
    *   `api_spec_template.md`: Mẫu cho tài liệu thiết kế tích hợp và đặc tả API.
    *   `ops_governance_template.md`: Mẫu cho tài liệu vận hành và quản trị.
*   **`references/`**
    *   `real_world_alignment_checklist.md`: Danh sách kiểm tra để đối soát tài liệu với hệ thống thực tế.

## Ví dụ sử dụng

Để bắt đầu tạo tài liệu kiến trúc hệ thống, bạn có thể sử dụng template như sau:

```python
print(default_api.file(action="write", path="/home/ubuntu/my_project/system_architecture.md", text=default_api.file(action="read", path="/home/ubuntu/skills/faos-documentation-architect/templates/system_architecture_template.md")))
```

Sau đó, bạn có thể đọc tài liệu thực tế và sử dụng checklist để cập nhật:

```python
print(default_api.file(action="view", path="/path/to/your/real_system_doc.pdf"))
print(default_api.file(action="read", path="/home/ubuntu/skills/faos-documentation-architect/references/real_world_alignment_checklist.md"))
# ... (thực hiện các chỉnh sửa dựa trên thông tin thực tế)
```

---
*Kỹ năng được tạo bởi **Manus AI**.*